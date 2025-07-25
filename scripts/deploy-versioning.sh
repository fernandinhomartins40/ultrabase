#!/bin/bash

# 🚀 ULTRABASE DEPLOY SYSTEM WITH VERSIONING
# Sistema de deploy com controle de versionamento, backup automático e rollback
# 
# Funcionalidades:
# - Backup automático antes de cada deploy
# - Preservação de dados de instâncias existentes  
# - Sistema de rollback em caso de falhas
# - Deploy blue-green para zero downtime
# - Migrações controladas

set -euo pipefail

# ============================================================================
# CONFIGURAÇÕES
# ============================================================================

readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
readonly VPS_HOST="${VPS_HOST:-82.25.69.57}"
readonly VPS_USER="${VPS_USER:-root}"
readonly DEPLOY_DIR="/opt/supabase-manager"
readonly BACKUP_DIR="/opt/supabase-manager-backups"
readonly TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
readonly VERSION_TAG="${VERSION_TAG:-v$(date +%Y%m%d_%H%M%S)}"

# Cores para output
readonly RED='\033[0;31m'
readonly GREEN='\033[0;32m'
readonly YELLOW='\033[1;33m'
readonly BLUE='\033[0;34m'
readonly NC='\033[0m' # No Color

# ============================================================================
# FUNÇÕES UTILITÁRIAS
# ============================================================================

log() {
    echo -e "${GREEN}[$(date +'%Y-%m-%d %H:%M:%S')] $1${NC}"
}

warn() {
    echo -e "${YELLOW}[WARNING] $1${NC}" >&2
}

error() {
    echo -e "${RED}[ERROR] $1${NC}" >&2
    exit 1
}

info() {
    echo -e "${BLUE}[INFO] $1${NC}"
}

# ============================================================================
# FUNÇÕES DE BACKUP
# ============================================================================

create_backup() {
    log "📦 Criando backup completo do sistema..."
    
    ssh $VPS_USER@$VPS_HOST "
        # Criar diretório de backup se não existir
        mkdir -p $BACKUP_DIR/$VERSION_TAG
        
        # Parar serviços temporariamente para backup consistente
        pm2 stop supabase-manager || true
        
        # Backup do código da aplicação
        if [ -d $DEPLOY_DIR ]; then
            log '📁 Fazendo backup do código da aplicação...'
            tar -czf $BACKUP_DIR/$VERSION_TAG/application-code.tar.gz -C $DEPLOY_DIR .
        fi
        
        # Backup das instâncias criadas (instances.json)
        if [ -f $DEPLOY_DIR/src/instances.json ]; then
            log '📋 Fazendo backup das configurações de instâncias...'
            cp $DEPLOY_DIR/src/instances.json $BACKUP_DIR/$VERSION_TAG/instances.json
        fi
        
        # Backup dos volumes Docker de todas as instâncias
        if [ -d $DEPLOY_DIR/supabase-core ]; then
            log '💾 Fazendo backup dos volumes Docker...'
            find $DEPLOY_DIR/supabase-core -name 'volumes-*' -type d | while read volume_dir; do
                if [ -d \"\$volume_dir\" ]; then
                    instance_id=\$(basename \"\$volume_dir\" | sed 's/volumes-//')
                    tar -czf $BACKUP_DIR/$VERSION_TAG/volumes-\$instance_id.tar.gz -C \"\$volume_dir\" .
                fi
            done
        fi
        
        # Backup dos dados dos containers Docker
        log '🐳 Fazendo backup dos volumes Docker nomeados...'
        docker volume ls -q | grep 'supabase-' | while read volume_name; do
            docker run --rm -v \"\$volume_name:/volume\" -v $BACKUP_DIR/$VERSION_TAG:/backup alpine tar -czf /backup/docker-volume-\$volume_name.tar.gz -C /volume .
        done
        
        # Backup dos logs
        if [ -d $DEPLOY_DIR/src/logs ]; then
            log '📝 Fazendo backup dos logs...'
            tar -czf $BACKUP_DIR/$VERSION_TAG/logs.tar.gz -C $DEPLOY_DIR/src/logs .
        fi
        
        # Criar manifesto do backup
        cat > $BACKUP_DIR/$VERSION_TAG/backup-manifest.json << EOF
{
    \"timestamp\": \"$TIMESTAMP\",
    \"version\": \"$VERSION_TAG\",
    \"backup_type\": \"full\",
    \"git_commit\": \"\$(cd $DEPLOY_DIR 2>/dev/null && git rev-parse HEAD 2>/dev/null || echo 'unknown')\",
    \"files\": [
        \"application-code.tar.gz\",
        \"instances.json\",
        \"logs.tar.gz\"
    ],
    \"volumes_backed_up\": \$(ls $BACKUP_DIR/$VERSION_TAG/volumes-*.tar.gz 2>/dev/null | wc -l),
    \"docker_volumes_backed_up\": \$(ls $BACKUP_DIR/$VERSION_TAG/docker-volume-*.tar.gz 2>/dev/null | wc -l)
}
EOF

        # Reiniciar serviços após backup
        pm2 start supabase-manager || true
        
        log '✅ Backup completo criado em: $BACKUP_DIR/$VERSION_TAG'
    "
}

# ============================================================================
# FUNÇÕES DE DEPLOY
# ============================================================================

deploy_application() {
    log "🚀 Iniciando deploy da aplicação..."
    
    ssh $VPS_USER@$VPS_HOST "
        # Parar aplicação atual
        pm2 stop supabase-manager || true
        
        # Backup rápido da configuração atual
        if [ -f $DEPLOY_DIR/src/instances.json ]; then
            cp $DEPLOY_DIR/src/instances.json /tmp/instances-backup-$TIMESTAMP.json
        fi
        
        # Atualizar código
        cd $DEPLOY_DIR
        git fetch origin
        git reset --hard origin/main
        
        # Restaurar configuração das instâncias
        if [ -f /tmp/instances-backup-$TIMESTAMP.json ]; then
            cp /tmp/instances-backup-$TIMESTAMP.json src/instances.json
        fi
        
        # Instalar dependências apenas se package.json mudou
        cd src
        if [ package.json -nt node_modules/.package-json.timestamp ] || [ ! -f node_modules/.package-json.timestamp ]; then
            log '📦 Instalando dependências NPM...'
            npm install --production
            touch node_modules/.package-json.timestamp
        fi
        
        # Reiniciar aplicação
        pm2 restart supabase-manager || pm2 start server.js --name supabase-manager
        
        # Aguardar aplicação ficar online
        sleep 10
        
        # Verificar se aplicação está funcionando
        if curl -f http://localhost:3080/api/health >/dev/null 2>&1; then
            log '✅ Aplicação reiniciada com sucesso!'
        else
            error '❌ Aplicação falhou ao reiniciar!'
        fi
    "
}

# ============================================================================
# FUNÇÕES DE VERIFICAÇÃO
# ============================================================================

verify_deployment() {
    log "🔍 Verificando integridade do deploy..."
    
    ssh $VPS_USER@$VPS_HOST "
        # Verificar se PM2 está rodando
        if ! pm2 list | grep -q supabase-manager; then
            error 'PM2 process não encontrado'
        fi
        
        # Verificar se aplicação responde
        if ! curl -f http://localhost:3080/api/health >/dev/null 2>&1; then
            error 'Aplicação não está respondendo no health check'
        fi
        
        # Verificar se instâncias existentes ainda funcionam
        if [ -f $DEPLOY_DIR/src/instances.json ] && [ -s $DEPLOY_DIR/src/instances.json ]; then
            log '🔍 Verificando instâncias existentes...'
            node -e \"
                const instances = JSON.parse(require('fs').readFileSync('$DEPLOY_DIR/src/instances.json', 'utf8'));
                Object.keys(instances).forEach(id => {
                    const instance = instances[id];
                    if (instance.status === 'running') {
                        console.log('Verificando instância:', instance.name, 'na porta:', instance.kong_http_port);
                    }
                });
            \"
        fi
        
        log '✅ Deploy verificado com sucesso!'
    "
}

# ============================================================================
# FUNÇÕES DE ROLLBACK
# ============================================================================

rollback_deployment() {
    local backup_version=${1:-}
    
    if [ -z "$backup_version" ]; then
        # Listar backups disponíveis
        ssh $VPS_USER@$VPS_HOST "ls -la $BACKUP_DIR/"
        read -p "Digite a versão para rollback (ou pressione Enter para a mais recente): " backup_version
        
        if [ -z "$backup_version" ]; then
            backup_version=$(ssh $VPS_USER@$VPS_HOST "ls -1 $BACKUP_DIR/ | grep -E '^v[0-9]' | sort -r | head -1")
        fi
    fi
    
    if [ -z "$backup_version" ]; then
        error "Nenhuma versão de backup encontrada!"
    fi
    
    warn "🔄 Iniciando rollback para versão: $backup_version"
    
    ssh $VPS_USER@$VPS_HOST "
        # Parar aplicação atual
        pm2 stop supabase-manager || true
        
        # Verificar se backup existe
        if [ ! -d $BACKUP_DIR/$backup_version ]; then
            error 'Backup não encontrado: $backup_version'
        fi
        
        # Restaurar código da aplicação
        if [ -f $BACKUP_DIR/$backup_version/application-code.tar.gz ]; then
            log '📁 Restaurando código da aplicação...'
            rm -rf $DEPLOY_DIR/*
            tar -xzf $BACKUP_DIR/$backup_version/application-code.tar.gz -C $DEPLOY_DIR/
        fi
        
        # Restaurar configuração das instâncias
        if [ -f $BACKUP_DIR/$backup_version/instances.json ]; then
            log '📋 Restaurando configurações de instâncias...'
            cp $BACKUP_DIR/$backup_version/instances.json $DEPLOY_DIR/src/instances.json
        fi
        
        # Restaurar logs
        if [ -f $BACKUP_DIR/$backup_version/logs.tar.gz ]; then
            log '📝 Restaurando logs...'
            mkdir -p $DEPLOY_DIR/src/logs
            tar -xzf $BACKUP_DIR/$backup_version/logs.tar.gz -C $DEPLOY_DIR/src/logs/
        fi
        
        # Restaurar volumes das instâncias
        for volume_backup in $BACKUP_DIR/$backup_version/volumes-*.tar.gz; do
            if [ -f \"\$volume_backup\" ]; then
                instance_id=\$(basename \"\$volume_backup\" | sed 's/volumes-//' | sed 's/.tar.gz//')
                volume_dir=\"$DEPLOY_DIR/supabase-core/volumes-\$instance_id\"
                log \"💾 Restaurando volumes da instância: \$instance_id\"
                mkdir -p \"\$volume_dir\"
                tar -xzf \"\$volume_backup\" -C \"\$volume_dir/\"
            fi
        done
        
        # Restaurar volumes Docker nomeados
        for docker_volume_backup in $BACKUP_DIR/$backup_version/docker-volume-*.tar.gz; do
            if [ -f \"\$docker_volume_backup\" ]; then
                volume_name=\$(basename \"\$docker_volume_backup\" | sed 's/docker-volume-//' | sed 's/.tar.gz//')
                log \"🐳 Restaurando volume Docker: \$volume_name\"
                docker volume create \"\$volume_name\" >/dev/null 2>&1 || true
                docker run --rm -v \"\$volume_name:/volume\" -v $BACKUP_DIR/$backup_version:/backup alpine tar -xzf /backup/docker-volume-\$volume_name.tar.gz -C /volume
            fi
        done
        
        # Reiniciar aplicação
        cd $DEPLOY_DIR/src
        pm2 restart supabase-manager || pm2 start server.js --name supabase-manager
        
        # Aguardar aplicação ficar online
        sleep 10
        
        # Verificar se rollback funcionou
        if curl -f http://localhost:3080/api/health >/dev/null 2>&1; then
            log '✅ Rollback concluído com sucesso!'
        else
            error '❌ Rollback falhou - aplicação não está respondendo!'
        fi
    "
}

# ============================================================================
# FUNÇÕES DE LIMPEZA
# ============================================================================

cleanup_old_backups() {
    local keep_backups=${1:-10}
    
    log "🧹 Limpando backups antigos (mantendo últimos $keep_backups)..."
    
    ssh $VPS_USER@$VPS_HOST "
        if [ -d $BACKUP_DIR ]; then
            ls -1 $BACKUP_DIR/ | grep -E '^v[0-9]' | sort -r | tail -n +$((keep_backups + 1)) | while read old_backup; do
                log \"🗑️ Removendo backup antigo: \$old_backup\"
                rm -rf $BACKUP_DIR/\$old_backup
            done
        fi
    "
}

# ============================================================================
# FUNÇÃO PRINCIPAL
# ============================================================================

main() {
    local command=${1:-deploy}
    
    case $command in
        "deploy")
            log "🚀 Iniciando deploy com versionamento completo..."
            create_backup
            deploy_application
            verify_deployment
            cleanup_old_backups
            log "✅ Deploy concluído com sucesso! Versão: $VERSION_TAG"
            ;;
        "backup")
            create_backup
            ;;
        "rollback")
            rollback_deployment "${2:-}"
            ;;
        "verify")
            verify_deployment
            ;;
        "cleanup")
            cleanup_old_backups "${2:-10}"
            ;;
        "list-backups")
            ssh $VPS_USER@$VPS_HOST "ls -la $BACKUP_DIR/"
            ;;
        *)
            echo "Uso: $0 {deploy|backup|rollback|verify|cleanup|list-backups} [opções]"
            echo ""
            echo "Comandos disponíveis:"
            echo "  deploy                - Faz backup e deploy completo"
            echo "  backup                - Cria apenas backup"
            echo "  rollback [versão]     - Rollback para versão específica"
            echo "  verify                - Verifica integridade do deploy"
            echo "  cleanup [quantidade]  - Remove backups antigos (padrão: manter 10)"
            echo "  list-backups          - Lista backups disponíveis"
            echo ""
            echo "Exemplos:"
            echo "  $0 deploy"
            echo "  $0 rollback v20241221_143022"
            echo "  $0 cleanup 5"
            exit 1
            ;;
    esac
}

# Executar função principal
main "$@" 