#!/bin/bash

# 🛡️ ULTRABASE DATA PRESERVATION SYSTEM
# Sistema de preservação de dados durante deploys
# 
# Garante que:
# - Volumes Docker das instâncias sejam preservados
# - Configurações das instâncias (instances.json) sejam mantidas
# - Dados do banco de cada instância sejam protegidos
# - Logs históricos sejam preservados

set -euo pipefail

# ============================================================================
# CONFIGURAÇÕES
# ============================================================================

readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly DEPLOY_DIR="/opt/supabase-manager"
readonly SAFE_DATA_DIR="/opt/supabase-manager-data-safe"
readonly VPS_HOST="${VPS_HOST:-82.25.69.57}"
readonly VPS_USER="${VPS_USER:-root}"

# Cores para output
readonly GREEN='\033[0;32m'
readonly YELLOW='\033[1;33m'
readonly RED='\033[0;31m'
readonly NC='\033[0m'

# ============================================================================
# FUNÇÕES UTILITÁRIAS
# ============================================================================

log() {
    echo -e "${GREEN}[PRESERVE] $1${NC}"
}

warn() {
    echo -e "${YELLOW}[WARNING] $1${NC}"
}

error() {
    echo -e "${RED}[ERROR] $1${NC}"
    exit 1
}

# ============================================================================
# FUNÇÕES DE PRESERVAÇÃO
# ============================================================================

preserve_instances_config() {
    log "🔒 Preservando configuração das instâncias..."
    
    ssh $VPS_USER@$VPS_HOST "
        # Criar diretório seguro se não existir
        mkdir -p $SAFE_DATA_DIR/configs
        
        # Preservar instances.json se existir
        if [ -f $DEPLOY_DIR/src/instances.json ]; then
            log '📋 Copiando instances.json para área segura...'
            cp $DEPLOY_DIR/src/instances.json $SAFE_DATA_DIR/configs/instances.json.$(date +%Y%m%d_%H%M%S)
            cp $DEPLOY_DIR/src/instances.json $SAFE_DATA_DIR/configs/instances.json
            
            # Mostrar quantas instâncias serão preservadas
            instances_count=\$(cat $DEPLOY_DIR/src/instances.json | jq 'length' 2>/dev/null || echo '0')
            log \"📊 Preservando configuração de \$instances_count instâncias\"
        else
            log 'ℹ️ Nenhuma configuração de instâncias encontrada'
        fi
        
        # Preservar usuários se existir
        if [ -f $DEPLOY_DIR/src/users.json ]; then
            log '👥 Preservando configuração de usuários...'
            cp $DEPLOY_DIR/src/users.json $SAFE_DATA_DIR/configs/users.json
        fi
    "
}

preserve_volumes() {
    log "💾 Preservando volumes das instâncias..."
    
    ssh $VPS_USER@$VPS_HOST "
        mkdir -p $SAFE_DATA_DIR/volumes
        
        # Preservar diretórios de volumes das instâncias
        if [ -d $DEPLOY_DIR/supabase-core ]; then
            find $DEPLOY_DIR/supabase-core -name 'volumes-*' -type d | while read volume_dir; do
                if [ -d \"\$volume_dir\" ]; then
                    instance_id=\$(basename \"\$volume_dir\" | sed 's/volumes-//')
                    log \"💾 Preservando volumes da instância: \$instance_id\"
                    
                    # Criar backup do volume inteiro
                    safe_volume_dir=\"$SAFE_DATA_DIR/volumes/volumes-\$instance_id\"
                    mkdir -p \"\$safe_volume_dir\"
                    
                    # Usar rsync para preservar permissões e links
                    rsync -av \"\$volume_dir/\" \"\$safe_volume_dir/\" || cp -r \"\$volume_dir/\" \"\$safe_volume_dir/\"
                fi
            done
        fi
        
        log '✅ Volumes preservados em $SAFE_DATA_DIR/volumes'
    "
}

preserve_docker_volumes() {
    log "🐳 Preservando volumes Docker nomeados..."
    
    ssh $VPS_USER@$VPS_HOST "
        mkdir -p $SAFE_DATA_DIR/docker-volumes
        
        # Listar e preservar volumes Docker relacionados ao Supabase
        docker volume ls -q | grep 'supabase-' | while read volume_name; do
            if [ -n \"\$volume_name\" ]; then
                log \"🐳 Preservando volume Docker: \$volume_name\"
                
                # Fazer backup do volume usando container temporário
                docker run --rm -v \"\$volume_name:/source\" -v $SAFE_DATA_DIR/docker-volumes:/backup alpine tar -czf /backup/\$volume_name.tar.gz -C /source .
            fi
        done
        
        log '✅ Volumes Docker preservados'
    "
}

preserve_logs() {
    log "📝 Preservando logs históricos..."
    
    ssh $VPS_USER@$VPS_HOST "
        mkdir -p $SAFE_DATA_DIR/logs
        
        # Preservar logs da aplicação principal
        if [ -d $DEPLOY_DIR/src/logs ]; then
            log '📝 Preservando logs da aplicação...'
            rsync -av $DEPLOY_DIR/src/logs/ $SAFE_DATA_DIR/logs/app/ || cp -r $DEPLOY_DIR/src/logs/* $SAFE_DATA_DIR/logs/app/ 2>/dev/null || true
        fi
        
        # Preservar logs do PM2
        if [ -d ~/.pm2/logs ]; then
            log '📝 Preservando logs do PM2...'
            mkdir -p $SAFE_DATA_DIR/logs/pm2
            cp ~/.pm2/logs/supabase-manager* $SAFE_DATA_DIR/logs/pm2/ 2>/dev/null || true
        fi
        
        # Preservar logs do sistema relacionados ao Docker
        if [ -f /var/log/docker.log ]; then
            log '📝 Preservando logs do Docker...'
            cp /var/log/docker.log $SAFE_DATA_DIR/logs/docker.log
        fi
        
        log '✅ Logs preservados'
    "
}

create_preservation_manifest() {
    log "📋 Criando manifesto de preservação..."
    
    ssh $VPS_USER@$VPS_HOST "
        # Criar manifesto com informações sobre o que foi preservado
        cat > $SAFE_DATA_DIR/preservation-manifest.json << EOF
{
    \"timestamp\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",
    \"preservation_version\": \"1.0\",
    \"git_commit\": \"\$(cd $DEPLOY_DIR 2>/dev/null && git rev-parse HEAD 2>/dev/null || echo 'unknown')\",
    \"preserved_data\": {
        \"instances_config\": \$([ -f $SAFE_DATA_DIR/configs/instances.json ] && echo 'true' || echo 'false'),
        \"users_config\": \$([ -f $SAFE_DATA_DIR/configs/users.json ] && echo 'true' || echo 'false'),
        \"volumes_count\": \$(find $SAFE_DATA_DIR/volumes -name 'volumes-*' -type d 2>/dev/null | wc -l),
        \"docker_volumes_count\": \$(find $SAFE_DATA_DIR/docker-volumes -name '*.tar.gz' 2>/dev/null | wc -l),
        \"logs_preserved\": \$([ -d $SAFE_DATA_DIR/logs ] && echo 'true' || echo 'false')
    },
    \"instances_preserved\": [
EOF

        # Adicionar lista de instâncias preservadas
        if [ -f $SAFE_DATA_DIR/configs/instances.json ]; then
            cat $SAFE_DATA_DIR/configs/instances.json | jq -r 'keys[]' 2>/dev/null | while read instance_id; do
                instance_name=\$(cat $SAFE_DATA_DIR/configs/instances.json | jq -r \".\\\"\$instance_id\\\".name\" 2>/dev/null || echo 'unknown')
                echo \"        {\\\"id\\\": \\\"\$instance_id\\\", \\\"name\\\": \\\"\$instance_name\\\"},\" >> $SAFE_DATA_DIR/preservation-manifest.json
            done
            # Remover última vírgula
            sed -i 's/,$//' $SAFE_DATA_DIR/preservation-manifest.json
        fi
        
        cat >> $SAFE_DATA_DIR/preservation-manifest.json << EOF
    ],
    \"disk_usage\": {
        \"safe_data_size\": \"\$(du -sh $SAFE_DATA_DIR 2>/dev/null | cut -f1 || echo 'unknown')\",
        \"available_space\": \"\$(df -h $SAFE_DATA_DIR 2>/dev/null | tail -1 | awk '{print \$4}' || echo 'unknown')\"
    }
}
EOF

        log '✅ Manifesto criado: $SAFE_DATA_DIR/preservation-manifest.json'
    "
}

# ============================================================================
# FUNÇÕES DE RESTAURAÇÃO
# ============================================================================

restore_instances_config() {
    log "🔄 Restaurando configuração das instâncias..."
    
    ssh $VPS_USER@$VPS_HOST "
        # Restaurar instances.json
        if [ -f $SAFE_DATA_DIR/configs/instances.json ]; then
            log '📋 Restaurando instances.json...'
            mkdir -p $DEPLOY_DIR/src
            cp $SAFE_DATA_DIR/configs/instances.json $DEPLOY_DIR/src/instances.json
            
            instances_count=\$(cat $DEPLOY_DIR/src/instances.json | jq 'length' 2>/dev/null || echo '0')
            log \"📊 Restauradas configurações de \$instances_count instâncias\"
        else
            log 'ℹ️ Nenhuma configuração para restaurar'
        fi
        
        # Restaurar users.json
        if [ -f $SAFE_DATA_DIR/configs/users.json ]; then
            log '👥 Restaurando configuração de usuários...'
            cp $SAFE_DATA_DIR/configs/users.json $DEPLOY_DIR/src/users.json
        fi
    "
}

restore_volumes() {
    log "💾 Restaurando volumes das instâncias..."
    
    ssh $VPS_USER@$VPS_HOST "
        if [ -d $SAFE_DATA_DIR/volumes ]; then
            find $SAFE_DATA_DIR/volumes -name 'volumes-*' -type d | while read safe_volume_dir; do
                instance_id=\$(basename \"\$safe_volume_dir\" | sed 's/volumes-//')
                target_volume_dir=\"$DEPLOY_DIR/supabase-core/volumes-\$instance_id\"
                
                log \"💾 Restaurando volumes da instância: \$instance_id\"
                mkdir -p \"\$target_volume_dir\"
                
                # Usar rsync para restaurar preservando permissões
                rsync -av \"\$safe_volume_dir/\" \"\$target_volume_dir/\" || cp -r \"\$safe_volume_dir/\" \"\$target_volume_dir/\"
            done
            
            log '✅ Volumes restaurados'
        else
            log 'ℹ️ Nenhum volume para restaurar'
        fi
    "
}

restore_docker_volumes() {
    log "🐳 Restaurando volumes Docker nomeados..."
    
    ssh $VPS_USER@$VPS_HOST "
        if [ -d $SAFE_DATA_DIR/docker-volumes ]; then
            find $SAFE_DATA_DIR/docker-volumes -name '*.tar.gz' | while read volume_backup; do
                volume_name=\$(basename \"\$volume_backup\" | sed 's/.tar.gz$//')
                
                log \"🐳 Restaurando volume Docker: \$volume_name\"
                
                # Criar volume se não existir
                docker volume create \"\$volume_name\" >/dev/null 2>&1 || true
                
                # Restaurar dados do volume
                docker run --rm -v \"\$volume_name:/target\" -v $SAFE_DATA_DIR/docker-volumes:/backup alpine tar -xzf /backup/\$(basename \"\$volume_backup\") -C /target
            done
            
            log '✅ Volumes Docker restaurados'
        else
            log 'ℹ️ Nenhum volume Docker para restaurar'
        fi
    "
}

# ============================================================================
# FUNÇÕES DE VERIFICAÇÃO
# ============================================================================

verify_preservation() {
    log "🔍 Verificando integridade dos dados preservados..."
    
    ssh $VPS_USER@$VPS_HOST "
        if [ ! -f $SAFE_DATA_DIR/preservation-manifest.json ]; then
            warn 'Manifesto de preservação não encontrado'
            return 1
        fi
        
        # Verificar se arquivos principais existem
        if [ -f $SAFE_DATA_DIR/configs/instances.json ]; then
            if cat $SAFE_DATA_DIR/configs/instances.json | jq . >/dev/null 2>&1; then
                log '✅ instances.json preservado e válido'
            else
                error 'instances.json preservado mas corrompido'
            fi
        fi
        
        # Verificar volumes
        volumes_count=\$(find $SAFE_DATA_DIR/volumes -name 'volumes-*' -type d 2>/dev/null | wc -l)
        log \"📊 Volumes preservados: \$volumes_count\"
        
        # Verificar volumes Docker
        docker_volumes_count=\$(find $SAFE_DATA_DIR/docker-volumes -name '*.tar.gz' 2>/dev/null | wc -l)
        log \"🐳 Volumes Docker preservados: \$docker_volumes_count\"
        
        # Mostrar uso do espaço
        size=\$(du -sh $SAFE_DATA_DIR 2>/dev/null | cut -f1 || echo 'unknown')
        log \"💾 Espaço usado para preservação: \$size\"
        
        log '✅ Verificação de integridade concluída'
    "
}

# ============================================================================
# FUNÇÃO PRINCIPAL
# ============================================================================

main() {
    local action=${1:-preserve}
    
    case $action in
        "preserve")
            log "🛡️ Iniciando preservação completa de dados..."
            preserve_instances_config
            preserve_volumes
            preserve_docker_volumes
            preserve_logs
            create_preservation_manifest
            verify_preservation
            log "✅ Preservação concluída!"
            ;;
        "restore")
            log "🔄 Iniciando restauração completa de dados..."
            restore_instances_config
            restore_volumes
            restore_docker_volumes
            log "✅ Restauração concluída!"
            ;;
        "verify")
            verify_preservation
            ;;
        "clean")
            local days_old=${2:-7}
            log "🧹 Limpando dados preservados com mais de $days_old dias..."
            ssh $VPS_USER@$VPS_HOST "
                find $SAFE_DATA_DIR -type f -mtime +$days_old -delete 2>/dev/null || true
                find $SAFE_DATA_DIR -type d -empty -delete 2>/dev/null || true
            "
            log "✅ Limpeza concluída!"
            ;;
        "status")
            ssh $VPS_USER@$VPS_HOST "
                echo '📊 STATUS DA PRESERVAÇÃO DE DADOS'
                echo '=================================='
                if [ -f $SAFE_DATA_DIR/preservation-manifest.json ]; then
                    echo 'Último backup de preservação:'
                    cat $SAFE_DATA_DIR/preservation-manifest.json | jq -r '.timestamp'
                    echo ''
                    echo 'Instâncias preservadas:'
                    cat $SAFE_DATA_DIR/preservation-manifest.json | jq -r '.instances_preserved[].name' 2>/dev/null | head -10
                    echo ''
                    echo 'Espaço usado:'
                    cat $SAFE_DATA_DIR/preservation-manifest.json | jq -r '.disk_usage.safe_data_size'
                else
                    echo 'Nenhum backup de preservação encontrado'
                fi
                echo ''
                echo 'Diretórios de preservação:'
                ls -la $SAFE_DATA_DIR/ 2>/dev/null || echo 'Diretório não existe'
            "
            ;;
        *)
            echo "Uso: $0 {preserve|restore|verify|clean|status} [opções]"
            echo ""
            echo "Comandos disponíveis:"
            echo "  preserve              - Preserva todos os dados importantes"
            echo "  restore               - Restaura dados preservados"
            echo "  verify                - Verifica integridade dos dados preservados"
            echo "  clean [dias]          - Remove dados preservados antigos (padrão: 7 dias)"
            echo "  status                - Mostra status da preservação"
            echo ""
            echo "Exemplos:"
            echo "  $0 preserve"
            echo "  $0 restore"
            echo "  $0 clean 14"
            exit 1
            ;;
    esac
}

# Executar função principal
main "$@" 