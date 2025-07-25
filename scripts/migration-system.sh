#!/bin/bash

# 🔄 ULTRABASE MIGRATION SYSTEM
# Sistema de migrações para alterações incrementais sem perda de dados
# 
# Funcionalidades:
# - Migrações sequenciais versionadas
# - Rollback de migrações específicas
# - Verificação de integridade antes/depois
# - Backup automático antes de cada migração
# - Logs detalhados de todas as operações

set -euo pipefail

# ============================================================================
# CONFIGURAÇÕES
# ============================================================================

readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly DEPLOY_DIR="/opt/supabase-manager"
readonly MIGRATIONS_DIR="$DEPLOY_DIR/migrations"
readonly MIGRATION_STATE_FILE="$DEPLOY_DIR/.migration-state.json"
readonly VPS_HOST="${VPS_HOST:-82.25.69.57}"
readonly VPS_USER="${VPS_USER:-root}"

# Cores para output
readonly GREEN='\033[0;32m'
readonly YELLOW='\033[1;33m'
readonly RED='\033[0;31m'
readonly BLUE='\033[0;34m'
readonly NC='\033[0m'

# ============================================================================
# FUNÇÕES UTILITÁRIAS
# ============================================================================

log() {
    echo -e "${GREEN}[MIGRATION] $1${NC}"
}

warn() {
    echo -e "${YELLOW}[WARNING] $1${NC}"
}

error() {
    echo -e "${RED}[ERROR] $1${NC}"
    exit 1
}

info() {
    echo -e "${BLUE}[INFO] $1${NC}"
}

# ============================================================================
# FUNÇÕES DE MIGRAÇÃO
# ============================================================================

initialize_migration_system() {
    log "🔧 Inicializando sistema de migrações..."
    
    ssh $VPS_USER@$VPS_HOST "
        # Criar diretórios de migração se não existirem
        mkdir -p $MIGRATIONS_DIR/{up,down,backups}
        
        # Criar arquivo de estado inicial se não existir
        if [ ! -f $MIGRATION_STATE_FILE ]; then
            cat > $MIGRATION_STATE_FILE << EOF
{
    \"current_version\": \"0000\",
    \"applied_migrations\": [],
    \"migration_history\": [],
    \"last_backup\": null,
    \"system_initialized\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"
}
EOF
            log '📋 Arquivo de estado criado: $MIGRATION_STATE_FILE'
        fi
        
        log '✅ Sistema de migrações inicializado'
    "
}

create_migration() {
    local migration_name=${1:-}
    
    if [ -z "$migration_name" ]; then
        read -p "Digite o nome da migração: " migration_name
    fi
    
    if [ -z "$migration_name" ]; then
        error "Nome da migração é obrigatório"
    fi
    
    # Sanitizar nome da migração
    migration_name=$(echo "$migration_name" | sed 's/[^a-zA-Z0-9_-]/_/g')
    
    local timestamp=$(date +%Y%m%d_%H%M%S)
    local migration_id="${timestamp}_${migration_name}"
    
    log "📝 Criando nova migração: $migration_id"
    
    ssh $VPS_USER@$VPS_HOST "
        # Criar arquivos de migração UP e DOWN
        cat > $MIGRATIONS_DIR/up/${migration_id}.sh << 'EOF'
#!/bin/bash
# Migração UP: $migration_name
# Data: $(date)
# Descrição: [ADICIONE DESCRIÇÃO AQUI]

set -euo pipefail

log() {
    echo \"[$(date +'%Y-%m-%d %H:%M:%S')] MIGRATION UP [$migration_id] \$1\"
}

log \"Iniciando migração: $migration_name\"

# ==========================================
# SUAS ALTERAÇÕES AQUI
# ==========================================

# Exemplo:
# log \"Atualizando configuração X...\"
# sed -i 's/old_value/new_value/g' /path/to/config.json

# log \"Reiniciando serviço Y...\"
# pm2 restart service-name

# log \"Verificando se alteração funcionou...\"
# if curl -f http://localhost:3080/api/health >/dev/null 2>&1; then
#     log \"✅ Verificação passou\"
# else
#     log \"❌ Verificação falhou\"
#     exit 1
# fi

log \"✅ Migração concluída: $migration_name\"
EOF

        cat > $MIGRATIONS_DIR/down/${migration_id}.sh << 'EOF'
#!/bin/bash
# Migração DOWN: $migration_name
# Data: $(date)
# Descrição: Reverter alterações de $migration_name

set -euo pipefail

log() {
    echo \"[$(date +'%Y-%m-%d %H:%M:%S')] MIGRATION DOWN [$migration_id] \$1\"
}

log \"Iniciando rollback da migração: $migration_name\"

# ==========================================
# REVERTER SUAS ALTERAÇÕES AQUI
# ==========================================

# Exemplo (reverso da migração UP):
# log \"Revertendo configuração X...\"
# sed -i 's/new_value/old_value/g' /path/to/config.json

# log \"Reiniciando serviço Y...\"
# pm2 restart service-name

log \"✅ Rollback concluído: $migration_name\"
EOF

        chmod +x $MIGRATIONS_DIR/up/${migration_id}.sh
        chmod +x $MIGRATIONS_DIR/down/${migration_id}.sh
        
        log '✅ Migração criada:'
        log '   UP:   $MIGRATIONS_DIR/up/${migration_id}.sh'
        log '   DOWN: $MIGRATIONS_DIR/down/${migration_id}.sh'
        log ''
        log '📝 Edite os arquivos para adicionar suas alterações específicas.'
    "
    
    echo ""
    echo "🎯 Próximos passos:"
    echo "1. Edite o arquivo UP para implementar as alterações"
    echo "2. Edite o arquivo DOWN para reverter as alterações"
    echo "3. Execute: $0 apply $migration_id"
    echo ""
    echo "Arquivos criados:"
    echo "  - $MIGRATIONS_DIR/up/${migration_id}.sh"
    echo "  - $MIGRATIONS_DIR/down/${migration_id}.sh"
}

list_migrations() {
    log "📋 Listando migrações disponíveis..."
    
    ssh $VPS_USER@$VPS_HOST "
        echo '=== MIGRAÇÕES DISPONÍVEIS ==='
        
        if [ -d $MIGRATIONS_DIR/up ]; then
            for migration_file in \$(ls $MIGRATIONS_DIR/up/*.sh 2>/dev/null | sort); do
                migration_id=\$(basename \"\$migration_file\" .sh)
                description=\$(grep '# Descrição:' \"\$migration_file\" | cut -d':' -f2- | xargs || echo 'Sem descrição')
                
                # Verificar se já foi aplicada
                if cat $MIGRATION_STATE_FILE | jq -r '.applied_migrations[]' 2>/dev/null | grep -q \"\$migration_id\"; then
                    status='✅ APLICADA'
                else
                    status='⏳ PENDENTE'
                fi
                
                echo \"\$status \$migration_id\"
                echo \"    Descrição: \$description\"
                echo \"\"
            done
        else
            echo 'Nenhuma migração encontrada'
        fi
        
        echo '=== HISTÓRICO DE MIGRAÇÕES ==='
        if [ -f $MIGRATION_STATE_FILE ]; then
            current_version=\$(cat $MIGRATION_STATE_FILE | jq -r '.current_version')
            echo \"Versão atual: \$current_version\"
            echo \"\"
            echo \"Últimas migrações aplicadas:\"
            cat $MIGRATION_STATE_FILE | jq -r '.migration_history[-5:][] | \"  \" + .timestamp + \" - \" + .migration_id + \" (\" + .action + \")\"' 2>/dev/null || echo '  Nenhuma migração no histórico'
        fi
    "
}

backup_before_migration() {
    local migration_id=${1}
    
    log "📦 Criando backup antes da migração: $migration_id"
    
    ssh $VPS_USER@$VPS_HOST "
        backup_dir=\"$MIGRATIONS_DIR/backups/before_${migration_id}_$(date +%Y%m%d_%H%M%S)\"
        mkdir -p \"\$backup_dir\"
        
        # Backup da configuração atual
        if [ -f $DEPLOY_DIR/src/instances.json ]; then
            cp $DEPLOY_DIR/src/instances.json \"\$backup_dir/instances.json\"
        fi
        
        if [ -f $MIGRATION_STATE_FILE ]; then
            cp $MIGRATION_STATE_FILE \"\$backup_dir/migration-state.json\"
        fi
        
        # Backup de arquivos de configuração críticos
        if [ -f $DEPLOY_DIR/src/package.json ]; then
            cp $DEPLOY_DIR/src/package.json \"\$backup_dir/package.json\"
        fi
        
        # Criar manifesto do backup
        cat > \"\$backup_dir/backup-info.json\" << EOF
{
    \"migration_id\": \"$migration_id\",
    \"backup_timestamp\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",
    \"git_commit\": \"\$(cd $DEPLOY_DIR && git rev-parse HEAD 2>/dev/null || echo 'unknown')\",
    \"system_status\": {
        \"pm2_running\": \$(pm2 list --no-colors | grep -q supabase-manager && echo 'true' || echo 'false'),
        \"docker_containers\": \$(docker ps -q | wc -l)
    }
}
EOF

        log \"✅ Backup criado: \$backup_dir\"
        
        # Atualizar estado com informação do backup
        tmp_file=\$(mktemp)
        cat $MIGRATION_STATE_FILE | jq \".last_backup = \\\"\$backup_dir\\\"\" > \"\$tmp_file\" && mv \"\$tmp_file\" $MIGRATION_STATE_FILE
    "
}

apply_migration() {
    local migration_id=${1:-}
    
    if [ -z "$migration_id" ]; then
        error "ID da migração é obrigatório"
    fi
    
    log "🚀 Aplicando migração: $migration_id"
    
    ssh $VPS_USER@$VPS_HOST "
        migration_file=\"$MIGRATIONS_DIR/up/${migration_id}.sh\"
        
        # Verificar se migração existe
        if [ ! -f \"\$migration_file\" ]; then
            error 'Migração não encontrada: $migration_id'
        fi
        
        # Verificar se migração já foi aplicada
        if cat $MIGRATION_STATE_FILE | jq -r '.applied_migrations[]' 2>/dev/null | grep -q \"$migration_id\"; then
            warn 'Migração já foi aplicada: $migration_id'
            exit 0
        fi
        
        log 'Verificando sistema antes da migração...'
        if ! pm2 list | grep -q supabase-manager; then
            warn 'PM2 não está rodando - sistema pode estar instável'
        fi
        
        log 'Executando migração UP...'
        if bash \"\$migration_file\"; then
            log '✅ Migração executada com sucesso'
            
            # Atualizar estado
            tmp_file=\$(mktemp)
            cat $MIGRATION_STATE_FILE | jq \"
                .current_version = \\\"$migration_id\\\" |
                .applied_migrations += [\\\"$migration_id\\\"] |
                .migration_history += [{
                    \\\"migration_id\\\": \\\"$migration_id\\\",
                    \\\"action\\\": \\\"apply\\\",
                    \\\"timestamp\\\": \\\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\\\",
                    \\\"success\\\": true
                }]
            \" > \"\$tmp_file\" && mv \"\$tmp_file\" $MIGRATION_STATE_FILE
            
            log '✅ Estado atualizado'
        else
            error 'Migração falhou - verifique os logs acima'
        fi
    "
}

rollback_migration() {
    local migration_id=${1:-}
    
    if [ -z "$migration_id" ]; then
        # Mostrar última migração aplicada
        log "🔍 Buscando última migração aplicada..."
        migration_id=$(ssh $VPS_USER@$VPS_HOST "cat $MIGRATION_STATE_FILE | jq -r '.applied_migrations[-1]' 2>/dev/null" || echo "")
        
        if [ -z "$migration_id" ] || [ "$migration_id" = "null" ]; then
            warn "Nenhuma migração para fazer rollback"
            return 0
        fi
        
        warn "🔄 Fazendo rollback da última migração: $migration_id"
    fi
    
    log "🔄 Fazendo rollback da migração: $migration_id"
    
    ssh $VPS_USER@$VPS_HOST "
        migration_file=\"$MIGRATIONS_DIR/down/${migration_id}.sh\"
        
        # Verificar se migração DOWN existe
        if [ ! -f \"\$migration_file\" ]; then
            error 'Migração DOWN não encontrada: $migration_id'
        fi
        
        # Verificar se migração foi aplicada
        if ! cat $MIGRATION_STATE_FILE | jq -r '.applied_migrations[]' 2>/dev/null | grep -q \"$migration_id\"; then
            warn 'Migração não foi aplicada: $migration_id'
            exit 0
        fi
        
        log 'Executando migração DOWN...'
        if bash \"\$migration_file\"; then
            log '✅ Rollback executado com sucesso'
            
            # Atualizar estado
            tmp_file=\$(mktemp)
            cat $MIGRATION_STATE_FILE | jq \"
                .applied_migrations = (.applied_migrations | map(select(. != \\\"$migration_id\\\"))) |
                .migration_history += [{
                    \\\"migration_id\\\": \\\"$migration_id\\\",
                    \\\"action\\\": \\\"rollback\\\",
                    \\\"timestamp\\\": \\\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\\\",
                    \\\"success\\\": true
                }]
            \" > \"\$tmp_file\" && mv \"\$tmp_file\" $MIGRATION_STATE_FILE
            
            # Atualizar versão atual para a migração anterior
            previous_migration=\$(cat $MIGRATION_STATE_FILE | jq -r '.applied_migrations[-1]' 2>/dev/null || echo '0000')
            tmp_file2=\$(mktemp)
            cat $MIGRATION_STATE_FILE | jq \".current_version = \\\"\$previous_migration\\\"\" > \"\$tmp_file2\" && mv \"\$tmp_file2\" $MIGRATION_STATE_FILE
            
            log '✅ Estado atualizado'
        else
            error 'Rollback falhou - verifique os logs acima'
        fi
    "
}

verify_system_integrity() {
    log "🔍 Verificando integridade do sistema..."
    
    ssh $VPS_USER@$VPS_HOST "
        echo '=== VERIFICAÇÃO DE INTEGRIDADE ==='
        
        # Verificar PM2
        if pm2 list | grep -q supabase-manager; then
            echo '✅ PM2: supabase-manager rodando'
        else
            echo '❌ PM2: supabase-manager não encontrado'
        fi
        
        # Verificar aplicação
        if curl -f http://localhost:3080/api/health >/dev/null 2>&1; then
            echo '✅ APP: Health check passou'
        else
            echo '❌ APP: Health check falhou'
        fi
        
        # Verificar instances.json
        if [ -f $DEPLOY_DIR/src/instances.json ]; then
            if cat $DEPLOY_DIR/src/instances.json | jq . >/dev/null 2>&1; then
                instances_count=\$(cat $DEPLOY_DIR/src/instances.json | jq 'length')
                echo \"✅ CONFIG: instances.json válido (\$instances_count instâncias)\"
            else
                echo '❌ CONFIG: instances.json corrompido'
            fi
        else
            echo 'ℹ️ CONFIG: instances.json não encontrado'
        fi
        
        # Verificar Docker
        if docker version >/dev/null 2>&1; then
            containers_count=\$(docker ps -q | wc -l)
            echo \"✅ DOCKER: Funcionando (\$containers_count containers ativos)\"
        else
            echo '❌ DOCKER: Não está funcionando'
        fi
        
        # Verificar sistema de migrações
        if [ -f $MIGRATION_STATE_FILE ]; then
            current_version=\$(cat $MIGRATION_STATE_FILE | jq -r '.current_version')
            applied_count=\$(cat $MIGRATION_STATE_FILE | jq -r '.applied_migrations | length')
            echo \"✅ MIGRATIONS: Sistema OK (versão \$current_version, \$applied_count aplicadas)\"
        else
            echo '❌ MIGRATIONS: Arquivo de estado não encontrado'
        fi
    "
}

# ============================================================================
# FUNÇÃO PRINCIPAL
# ============================================================================

main() {
    local command=${1:-list}
    
    case $command in
        "init")
            initialize_migration_system
            ;;
        "create")
            create_migration "${2:-}"
            ;;
        "list")
            list_migrations
            ;;
        "apply")
            if [ -z "${2:-}" ]; then
                error "ID da migração é obrigatório para apply"
            fi
            backup_before_migration "${2}"
            apply_migration "${2}"
            verify_system_integrity
            ;;
        "rollback")
            rollback_migration "${2:-}"
            verify_system_integrity
            ;;
        "status")
            ssh $VPS_USER@$VPS_HOST "
                if [ -f $MIGRATION_STATE_FILE ]; then
                    echo '📊 STATUS DO SISTEMA DE MIGRAÇÕES'
                    echo '================================='
                    cat $MIGRATION_STATE_FILE | jq -r '
                        \"Versão atual: \" + .current_version,
                        \"Migrações aplicadas: \" + (.applied_migrations | length | tostring),
                        \"Último backup: \" + (.last_backup // \"Nenhum\"),
                        \"Sistema inicializado: \" + .system_initialized
                    '
                    echo ''
                    echo 'Últimas 3 operações:'
                    cat $MIGRATION_STATE_FILE | jq -r '.migration_history[-3:][] | \"  \" + .timestamp + \" - \" + .migration_id + \" (\" + .action + \")\"'
                else
                    echo 'Sistema de migrações não inicializado'
                    echo 'Execute: $0 init'
                fi
            "
            ;;
        "verify")
            verify_system_integrity
            ;;
        "cleanup")
            local days_old=${2:-30}
            log "🧹 Limpando backups de migração com mais de $days_old dias..."
            ssh $VPS_USER@$VPS_HOST "
                find $MIGRATIONS_DIR/backups -type d -mtime +$days_old -exec rm -rf {} + 2>/dev/null || true
            "
            log "✅ Limpeza concluída!"
            ;;
        *)
            echo "Sistema de Migrações do Ultrabase"
            echo "================================="
            echo ""
            echo "Uso: $0 {comando} [opções]"
            echo ""
            echo "Comandos disponíveis:"
            echo "  init                     - Inicializar sistema de migrações"
            echo "  create [nome]            - Criar nova migração"
            echo "  list                     - Listar migrações disponíveis"
            echo "  apply [migration_id]     - Aplicar migração específica"
            echo "  rollback [migration_id]  - Fazer rollback (padrão: última)"
            echo "  status                   - Status do sistema de migrações"
            echo "  verify                   - Verificar integridade do sistema"
            echo "  cleanup [dias]           - Limpar backups antigos (padrão: 30 dias)"
            echo ""
            echo "Exemplos:"
            echo "  $0 init"
            echo "  $0 create \"adicionar_nova_funcionalidade\""
            echo "  $0 apply 20241221_143022_adicionar_nova_funcionalidade"
            echo "  $0 rollback"
            echo "  $0 list"
            exit 1
            ;;
    esac
}

# Executar função principal
main "$@" 