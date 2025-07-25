#!/bin/bash

# ============================================================================
# SCRIPT COMPLETO: PREPARAÇÃO VPS + DEPLOY ULTRABASE
# ============================================================================
# Este script prepara a VPS do zero e faz deploy preservando dados existentes
# 
# Uso:
#   bash scripts/prepare-and-deploy.sh [prepare|deploy|full]
#
# Opções:
#   prepare - Apenas preparar a VPS (instalar dependências)
#   deploy  - Apenas fazer deploy (assumindo VPS já preparada)
#   full    - Preparar + Deploy completo (padrão)
# ============================================================================

set -euo pipefail

# Cores para logs
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# Configurações
VPS_HOST="82.25.69.57"
VPS_USER="root"
DEPLOY_DIR="/opt/supabase-manager"
BACKUP_DIR="/opt/supabase-manager-backups"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Função de log
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

header() {
    echo -e "${CYAN}"
    echo "============================================================================"
    echo " $1"
    echo "============================================================================"
    echo -e "${NC}"
}

# Verificar se temos acesso SSH
check_ssh_access() {
    log "🔍 Verificando acesso SSH à VPS..."
    
    log "⚠️ Será solicitada a senha SSH para conectar na VPS"
    if ! ssh -o ConnectTimeout=10 -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null "$VPS_USER@$VPS_HOST" "echo 'SSH OK'"; then
        error "❌ Não foi possível conectar via SSH. Verifique suas credenciais/chaves SSH."
    fi
    
    log "✅ Acesso SSH confirmado"
}

# Preparar VPS com todas as dependências
prepare_vps() {
    header "PREPARAÇÃO DA VPS"
    
    log "🚀 Iniciando preparação da VPS $VPS_HOST..."
    
    ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null "$VPS_USER@$VPS_HOST" << 'EOF'
        set -euo pipefail
        
        # Cores para logs remotos
        RED='\033[0;31m'
        GREEN='\033[0;32m'
        YELLOW='\033[1;33m'
        BLUE='\033[0;34m'
        NC='\033[0m'
        
        log() { echo -e "${GREEN}[$(date +'%Y-%m-%d %H:%M:%S')] $1${NC}"; }
        warn() { echo -e "${YELLOW}[WARNING] $1${NC}" >&2; }
        error() { echo -e "${RED}[ERROR] $1${NC}" >&2; exit 1; }
        info() { echo -e "${BLUE}[INFO] $1${NC}"; }
        
        log "🔄 Atualizando sistema..."
        apt update && apt upgrade -y
        
        log "📦 Instalando dependências básicas..."
        apt install -y curl wget git unzip software-properties-common apt-transport-https \
                       ca-certificates gnupg lsb-release jq htop tmux nginx fail2ban ufw
        
        # Instalar Node.js 18+ via NodeSource
        log "📦 Instalando Node.js..."
        if ! command -v node >/dev/null 2>&1; then
            curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
            apt install -y nodejs
        fi
        
        NODE_VERSION=$(node --version 2>/dev/null || echo "none")
        log "✅ Node.js instalado: $NODE_VERSION"
        
        # Instalar PM2
        log "📦 Instalando PM2..."
        if ! command -v pm2 >/dev/null 2>&1; then
            npm install -g pm2
            pm2 startup
        fi
        
        log "✅ PM2 instalado: $(pm2 --version)"
        
        # Instalar Docker
        log "🐳 Instalando Docker..."
        if ! command -v docker >/dev/null 2>&1; then
            curl -fsSL https://get.docker.com | bash
            systemctl start docker
            systemctl enable docker
            usermod -aG docker $USER
        fi
        
        log "✅ Docker instalado: $(docker --version)"
        
        # Instalar Docker Compose
        log "🐳 Instalando Docker Compose..."
        if ! command -v docker-compose >/dev/null 2>&1; then
            curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" \
                 -o /usr/local/bin/docker-compose
            chmod +x /usr/local/bin/docker-compose
        fi
        
        log "✅ Docker Compose instalado: $(docker-compose --version)"
        
        # Configurar diretórios
        log "📁 Configurando diretórios..."
        mkdir -p /opt/supabase-manager
        mkdir -p /opt/supabase-manager-backups
        
        # Configurar firewall básico
        log "🔥 Configurando firewall..."
        ufw --force reset
        ufw default deny incoming
        ufw default allow outgoing
        ufw allow ssh
        ufw allow 80
        ufw allow 443
        ufw allow 3080
        ufw allow 8000:8999/tcp  # Range para instâncias Supabase
        echo "y" | ufw enable
        
        # Configurar fail2ban
        log "🛡️ Configurando fail2ban..."
        systemctl enable fail2ban
        systemctl start fail2ban
        
        log "🎉 Preparação da VPS concluída!"
        log "📊 Resumo do sistema:"
        echo "   - OS: $(lsb_release -d | cut -f2)"
        echo "   - Node.js: $(node --version)"
        echo "   - NPM: $(npm --version)"
        echo "   - PM2: $(pm2 --version)"
        echo "   - Docker: $(docker --version | cut -d, -f1)"
        echo "   - Docker Compose: $(docker-compose --version | cut -d, -f1)"
        echo "   - Espaço em disco: $(df -h / | tail -1 | awk '{print $4}') disponível"
EOF

    log "✅ Preparação da VPS concluída!"
}

# Fazer backup dos dados existentes
backup_existing_data() {
    header "BACKUP DE DADOS EXISTENTES"
    
    log "💾 Fazendo backup dos dados existentes..."
    
    TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
    BACKUP_PATH="$BACKUP_DIR/backup_$TIMESTAMP"
    
    ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null "$VPS_USER@$VPS_HOST" << EOF
        set -euo pipefail
        
        # Cores para logs
        GREEN='\033[0;32m'
        YELLOW='\033[1;33m'
        NC='\033[0m'
        
        log() { echo -e "\${GREEN}[$(date +'%Y-%m-%d %H:%M:%S')] \$1\${NC}"; }
        warn() { echo -e "\${YELLOW}[WARNING] \$1\${NC}" >&2; }
        
        mkdir -p "$BACKUP_PATH"
        
        # Parar aplicação para backup consistente
        log "⏸️ Parando aplicação para backup consistente..."
        pm2 stop all 2>/dev/null || true
        
        # Backup do código da aplicação
        if [ -d "$DEPLOY_DIR" ]; then
            log "📁 Backup do código da aplicação..."
            tar -czf "$BACKUP_PATH/application-code.tar.gz" -C "$DEPLOY_DIR" . 2>/dev/null || true
        fi
        
        # Backup das instâncias
        if [ -f "$DEPLOY_DIR/src/instances.json" ]; then
            log "📋 Backup das configurações de instâncias..."
            cp "$DEPLOY_DIR/src/instances.json" "$BACKUP_PATH/instances.json"
        fi
        
        # Backup dos logs
        if [ -d "$DEPLOY_DIR/src/logs" ]; then
            log "📝 Backup dos logs..."
            tar -czf "$BACKUP_PATH/logs.tar.gz" -C "$DEPLOY_DIR/src/logs" . 2>/dev/null || true
        fi
        
        # Backup dos volumes Docker
        if [ -d "$DEPLOY_DIR/supabase-core" ]; then
            log "💾 Backup dos volumes Docker..."
            find "$DEPLOY_DIR/supabase-core" -name 'volumes-*' -type d 2>/dev/null | while read volume_dir; do
                if [ -d "\$volume_dir" ]; then
                    instance_id=\$(basename "\$volume_dir" | sed 's/volumes-//')
                    tar -czf "$BACKUP_PATH/volumes-\$instance_id.tar.gz" -C "\$volume_dir" . 2>/dev/null || true
                fi
            done
        fi
        
        # Backup dos volumes Docker nomeados
        log "🐳 Backup dos volumes Docker nomeados..."
        docker volume ls -q 2>/dev/null | grep 'supabase-' | while read volume_name; do
            docker run --rm -v "\$volume_name:/volume" -v "$BACKUP_PATH:/backup" alpine tar -czf "/backup/docker-volume-\$volume_name.tar.gz" -C /volume . 2>/dev/null || true
        done
        
        # Criar manifesto do backup
        cat > "$BACKUP_PATH/backup-manifest.json" << EOL
{
    "timestamp": "$TIMESTAMP",
    "backup_type": "full",
    "created_by": "prepare-and-deploy.sh",
    "vps_host": "$VPS_HOST",
    "backup_path": "$BACKUP_PATH"
}
EOL
        
        log "✅ Backup completo criado: $BACKUP_PATH"
        ls -la "$BACKUP_PATH/" 2>/dev/null || true
EOF

    log "✅ Backup dos dados existentes concluído!"
}

# Deploy da aplicação
deploy_application() {
    header "DEPLOY DA APLICAÇÃO"
    
    log "🚀 Iniciando deploy da aplicação..."
    
    # Enviar código para VPS
    log "📤 Enviando código para VPS..."
    rsync -avz --delete \
        --exclude '.git' \
        --exclude 'node_modules' \
        --exclude '.env' \
        --exclude '*.log' \
        -e "ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null" \
        "$PROJECT_ROOT/" "$VPS_USER@$VPS_HOST:$DEPLOY_DIR/"
    
    # Executar deploy na VPS
    ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null "$VPS_USER@$VPS_HOST" << EOF
        set -euo pipefail
        
        # Cores para logs
        GREEN='\033[0;32m'
        YELLOW='\033[1;33m'
        BLUE='\033[0;34m'
        NC='\033[0m'
        
        log() { echo -e "\${GREEN}[$(date +'%Y-%m-%d %H:%M:%S')] \$1\${NC}"; }
        warn() { echo -e "\${YELLOW}[WARNING] \$1\${NC}" >&2; }
        info() { echo -e "\${BLUE}[INFO] \$1\${NC}"; }
        
        cd "$DEPLOY_DIR"
        
        # Restaurar dados preservados se existirem
        LATEST_BACKUP=\$(ls -t "$BACKUP_DIR"/backup_* 2>/dev/null | head -1 || echo "")
        if [ -n "\$LATEST_BACKUP" ] && [ -d "\$LATEST_BACKUP" ]; then
            log "🔄 Restaurando dados preservados do backup: \$LATEST_BACKUP"
            
            # Restaurar instances.json
            if [ -f "\$LATEST_BACKUP/instances.json" ]; then
                mkdir -p src
                cp "\$LATEST_BACKUP/instances.json" src/instances.json
                log "✅ instances.json restaurado"
            fi
            
            # Restaurar logs
            if [ -f "\$LATEST_BACKUP/logs.tar.gz" ]; then
                mkdir -p src/logs
                tar -xzf "\$LATEST_BACKUP/logs.tar.gz" -C src/logs 2>/dev/null || true
                log "✅ Logs restaurados"
            fi
            
            # Restaurar volumes de instâncias
            find "\$LATEST_BACKUP" -name 'volumes-*.tar.gz' 2>/dev/null | while read volume_backup; do
                instance_id=\$(basename "\$volume_backup" | sed 's/volumes-//' | sed 's/.tar.gz//')
                volume_dir="supabase-core/volumes-\$instance_id"
                mkdir -p "\$volume_dir"
                tar -xzf "\$volume_backup" -C "\$volume_dir" 2>/dev/null || true
                log "✅ Volume da instância \$instance_id restaurado"
            done
        fi
        
        # Instalar dependências
        log "📦 Instalando dependências NPM..."
        cd src
        npm install --production
        
        # Parar aplicação anterior
        log "⏸️ Parando aplicação anterior..."
        pm2 stop supabase-manager 2>/dev/null || true
        pm2 delete supabase-manager 2>/dev/null || true
        
        # Iniciar aplicação
        log "🚀 Iniciando aplicação..."
        pm2 start server.js --name supabase-manager
        pm2 save
        
        # Configurar nginx se necessário
        log "🌐 Configurando nginx..."
        if [ -f "../docker/nginx.conf" ]; then
            cp ../docker/nginx.conf /etc/nginx/nginx.conf
            systemctl restart nginx
            systemctl enable nginx
        fi
        
        log "✅ Deploy da aplicação concluído!"
EOF

    log "✅ Deploy da aplicação concluído!"
}

# Verificar se aplicação está funcionando
verify_deployment() {
    header "VERIFICAÇÃO DO DEPLOY"
    
    log "🔍 Verificando se aplicação está funcionando..."
    
    # Aguardar aplicação inicializar
    sleep 10
    
    ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null "$VPS_USER@$VPS_HOST" << 'EOF'
        set -euo pipefail
        
        GREEN='\033[0;32m'
        RED='\033[0;31m'
        YELLOW='\033[1;33m'
        NC='\033[0m'
        
        log() { echo -e "${GREEN}[$(date +'%Y-%m-%d %H:%M:%S')] $1${NC}"; }
        error() { echo -e "${RED}[ERROR] $1${NC}" >&2; }
        warn() { echo -e "${YELLOW}[WARNING] $1${NC}" >&2; }
        
        # Verificar PM2
        if pm2 list | grep -q supabase-manager; then
            log "✅ PM2 está rodando"
        else
            error "❌ PM2 não está rodando"
            exit 1
        fi
        
        # Verificar se aplicação responde
        ATTEMPTS=0
        MAX_ATTEMPTS=12
        
        while [ $ATTEMPTS -lt $MAX_ATTEMPTS ]; do
            if curl -f -s http://localhost:3080/api/health >/dev/null 2>&1; then
                log "✅ Aplicação respondendo na porta 3080"
                break
            else
                ATTEMPTS=$((ATTEMPTS + 1))
                warn "⏳ Tentativa $ATTEMPTS/$MAX_ATTEMPTS - Aguardando aplicação..."
                sleep 5
            fi
        done
        
        if [ $ATTEMPTS -eq $MAX_ATTEMPTS ]; then
            error "❌ Aplicação não está respondendo após $MAX_ATTEMPTS tentativas"
            exit 1
        fi
        
        # Verificar instâncias preservadas
        if [ -f /opt/supabase-manager/src/instances.json ] && [ -s /opt/supabase-manager/src/instances.json ]; then
            INSTANCE_COUNT=$(cat /opt/supabase-manager/src/instances.json | jq 'length' 2>/dev/null || echo "0")
            log "📊 Instâncias preservadas: $INSTANCE_COUNT"
        fi
        
        log "🎉 Verificação concluída com sucesso!"
EOF

    log "✅ Verificação do deploy concluída!"
}

# Mostrar relatório final
show_final_report() {
    header "RELATÓRIO FINAL"
    
    ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null "$VPS_USER@$VPS_HOST" << 'EOF'
        set -euo pipefail
        
        CYAN='\033[0;36m'
        GREEN='\033[0;32m'
        NC='\033[0m'
        
        echo -e "${CYAN}📊 RELATÓRIO FINAL DO DEPLOY${NC}"
        echo "================================"
        echo "🕒 Data/Hora: $(date)"
        echo "🖥️  VPS: $(hostname) ($(curl -s ifconfig.me 2>/dev/null || echo 'IP não detectado'))"
        echo ""
        echo "📋 Status dos serviços:"
        pm2 list --no-colors | grep -E 'name|supabase-manager' || echo 'PM2 não encontrado'
        echo ""
        echo "🐳 Containers Docker:"
        docker ps --format 'table {{.Names}}\t{{.Status}}' | head -5 || echo 'Nenhum container ativo'
        echo ""
        echo "💾 Backups disponíveis:"
        ls -la /opt/supabase-manager-backups/ 2>/dev/null | tail -5 || echo 'Nenhum backup encontrado'
        echo ""
        echo "📊 Uso do disco:"
        df -h | grep -E '/$|/opt'
        echo ""
        echo -e "${GREEN}🎯 URLs disponíveis:${NC}"
        echo "   - Dashboard: http://82.25.69.57/"
        echo "   - API: http://82.25.69.57:3080/"
        echo "   - Health Check: http://82.25.69.57:3080/api/health"
        echo ""
        echo "✅ Deploy finalizado com sucesso!"
EOF
}

# Função principal
main() {
    local action="${1:-full}"
    
    header "ULTRABASE DEPLOY SCRIPT"
    log "🚀 Iniciando script de deploy - Ação: $action"
    
    # Verificar acesso SSH
    check_ssh_access
    
    case "$action" in
        "prepare")
            prepare_vps
            ;;
        "deploy")
            backup_existing_data
            deploy_application
            verify_deployment
            show_final_report
            ;;
        "full"|*)
            prepare_vps
            backup_existing_data
            deploy_application
            verify_deployment
            show_final_report
            ;;
    esac
    
    log "🎉 Script concluído com sucesso!"
}

# Executar script
main "$@" 