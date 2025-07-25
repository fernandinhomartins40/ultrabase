#!/bin/bash

# Script para deploy manual com versionamento - Ultrabase
# Usa a mesma lógica do GitHub Actions mas executado localmente

set -e

VPS_HOST="82.25.69.57"
VPS_USER="root"
DEPLOY_DIR="/opt/supabase-manager"
BACKUP_DIR="/opt/supabase-manager-backups"
VERSION_TAG="v$(date +%Y%m%d_%H%M%S)_manual"

echo "🚀 DEPLOY MANUAL COM VERSIONAMENTO - Ultrabase"
echo "=============================================="
echo "Versão: $VERSION_TAG"
echo "Servidor: $VPS_HOST"
echo "=============================================="

# Usar sshpass se disponível, senão pedir senha
if command -v sshpass >/dev/null 2>&1; then
    echo "ℹ️  Use: export VPS_PASSWORD='sua_senha' && bash manual_deploy.sh"
    if [ -z "$VPS_PASSWORD" ]; then
        read -s -p "Digite a senha SSH: " VPS_PASSWORD
        echo
    fi
    SSH_CMD="sshpass -p '$VPS_PASSWORD' ssh -o StrictHostKeyChecking=no"
else
    echo "ℹ️  Digite a senha SSH quando solicitado"
    SSH_CMD="ssh -o StrictHostKeyChecking=no"
fi

echo "📡 Conectando ao servidor..."

$SSH_CMD $VPS_USER@$VPS_HOST << 'DEPLOY_SCRIPT'

# ============================================================================
# SISTEMA DE DEPLOY COM VERSIONAMENTO - ULTRABASE (MANUAL)
# ============================================================================

set -euo pipefail

# Cores para logs
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

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

# Configurações
DEPLOY_DIR="/opt/supabase-manager"
BACKUP_DIR="/opt/supabase-manager-backups"
VERSION_TAG="v$(date +%Y%m%d_%H%M%S)_manual"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")

log "🚀 Iniciando deploy manual com versionamento - Versão: $VERSION_TAG"

# ============================================================================
# ETAPA 1: DIAGNÓSTICO INICIAL
# ============================================================================

log "🔍 ETAPA 1: Diagnóstico do sistema atual..."

# Verificar se Docker está rodando
if ! docker info >/dev/null 2>&1; then
    error "Docker não está rodando"
fi

# Verificar containers atuais
log "📦 Containers ativos:"
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" || true

# Verificar se nginx está rodando
if pgrep nginx > /dev/null; then
    log "✅ Nginx está rodando"
else
    warn "⚠️ Nginx não está rodando"
fi

# Verificar se PM2 está rodando
if command -v pm2 >/dev/null 2>&1; then
    log "📋 Processos PM2:"
    pm2 list || true
else
    warn "⚠️ PM2 não está instalado"
fi

# Verificar portas em uso
log "🌐 Portas em uso:"
netstat -tlnp | grep -E ':(80|443|3080)' || echo "Nenhuma porta relevante em uso"

log "✅ Diagnóstico inicial concluído"

# ============================================================================
# ETAPA 2: BACKUP COMPLETO
# ============================================================================

log "📦 ETAPA 2: Criando backup completo..."

BACKUP_PATH="$BACKUP_DIR/$VERSION_TAG"
mkdir -p "$BACKUP_PATH"

# Parar aplicação temporariamente
log "⏸️ Parando aplicação para backup consistente..."
if command -v pm2 >/dev/null 2>&1; then
    pm2 stop supabase-manager 2>/dev/null || true
fi

# Parar containers Docker
log "⏸️ Parando containers Docker..."
docker compose -f $DEPLOY_DIR/src/docker/docker-compose.production.yml down 2>/dev/null || true

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

# Criar manifesto do backup
cat > "$BACKUP_PATH/backup-manifest.json" << EOF
{
    "timestamp": "$TIMESTAMP",
    "version": "$VERSION_TAG",
    "backup_type": "manual_full",
    "deploy_reason": "fix_502_error"
}
EOF

log "✅ Backup completo criado: $BACKUP_PATH"

# ============================================================================
# ETAPA 3: ATUALIZAR CÓDIGO
# ============================================================================

log "🚀 ETAPA 3: Atualizando código..."

cd "$DEPLOY_DIR"

# Atualizar repositório
if [ -d ".git" ]; then
    log "🔄 Atualizando repositório..."
    git fetch origin
    git reset --hard origin/main
    git clean -fd
else
    log "🆕 Clonando repositório..."
    rm -rf * .* 2>/dev/null || true
    git clone https://github.com/fernandinhomartins40/ultrabase.git . || {
        error "Falha ao clonar repositório"
    }
fi

# Restaurar instâncias se existirem
if [ -f "$BACKUP_PATH/instances.json" ]; then
    cp "$BACKUP_PATH/instances.json" src/instances.json
    log "✅ Configurações de instâncias restauradas"
fi

# Instalar dependências
cd src
log "📦 Instalando dependências NPM..."
npm install --production

log "✅ Código atualizado"

# ============================================================================
# ETAPA 4: CORRIGIR CONFIGURAÇÕES DOCKER
# ============================================================================

log "🔧 ETAPA 4: Corrigindo configurações Docker..."

cd "$DEPLOY_DIR/src/docker"

# Verificar se arquivos existem
if [ ! -f "docker-compose.production.yml" ]; then
    error "docker-compose.production.yml não encontrado"
fi

if [ ! -f "nginx.conf" ]; then
    error "nginx.conf não encontrado"
fi

log "✅ Arquivos de configuração encontrados"

# ============================================================================
# ETAPA 5: REINICIAR SERVIÇOS COM NOVA CONFIGURAÇÃO
# ============================================================================

log "🔄 ETAPA 5: Reiniciando serviços..."

# Instalar PM2 se necessário
if ! command -v pm2 >/dev/null 2>&1; then
    log "📦 Instalando PM2..."
    npm install -g pm2
fi

# Iniciar containers Docker com nova configuração
cd "$DEPLOY_DIR/src/docker"
log "🐳 Iniciando containers Docker..."
docker compose -f docker-compose.production.yml up -d --force-recreate

# Aguardar containers ficarem prontos
log "⏳ Aguardando containers ficarem prontos..."
sleep 30

# Verificar status dos containers
log "📦 Status dos containers:"
docker compose -f docker-compose.production.yml ps

# Iniciar aplicação Node.js
cd "$DEPLOY_DIR/src"
log "🚀 Iniciando aplicação Node.js..."
pm2 restart supabase-manager 2>/dev/null || pm2 start server.js --name supabase-manager

# ============================================================================
# ETAPA 6: VERIFICAÇÕES PÓS-DEPLOY
# ============================================================================

log "🔍 ETAPA 6: Verificações pós-deploy..."

# Aguardar serviços ficarem prontos
sleep 15

# Verificar PM2
if pm2 list | grep -q supabase-manager; then
    log "✅ PM2 está rodando"
else
    warn "⚠️ PM2 não está rodando corretamente"
    pm2 logs supabase-manager --lines 10 || true
fi

# Verificar containers
if docker ps | grep -q supabase-manager-nginx; then
    log "✅ Container nginx está rodando"
else
    warn "⚠️ Container nginx não está rodando"
fi

if docker ps | grep -q supabase-instance-manager; then
    log "✅ Container manager está rodando"
else
    warn "⚠️ Container manager não está rodando"
fi

# Verificar conectividade interna
log "🔍 Testando conectividade interna..."

# Testar aplicação diretamente
if curl -f -s http://localhost:3080/api/health >/dev/null 2>&1; then
    log "✅ Aplicação responde na porta 3080"
else
    warn "⚠️ Aplicação não responde na porta 3080"
fi

# Testar nginx
if curl -f -s http://localhost:80 >/dev/null 2>&1; then
    log "✅ Nginx responde na porta 80"
else
    warn "⚠️ Nginx não responde na porta 80"
fi

# Verificar logs do nginx
log "📋 Logs do nginx:"
docker logs supabase-manager-nginx --tail 10 2>/dev/null || echo "Não foi possível obter logs do nginx"

# Verificar logs da aplicação
log "📋 Logs da aplicação:"
docker logs supabase-instance-manager --tail 10 2>/dev/null || echo "Não foi possível obter logs da aplicação"

# ============================================================================
# RESULTADO FINAL
# ============================================================================

log "🎉 DEPLOY MANUAL CONCLUÍDO!"
log "========================="
log "✅ Versão: $VERSION_TAG"
log "✅ Backup: $BACKUP_PATH"
log ""
log "🌐 Teste a aplicação:"
log "   http://82.25.69.57"
log ""
log "🔍 Para debug adicional:"
log "   docker logs supabase-manager-nginx"
log "   docker logs supabase-instance-manager"
log "   pm2 logs supabase-manager"

DEPLOY_SCRIPT

echo "✅ Deploy manual concluído!"
echo "🌐 Teste: http://$VPS_HOST" 