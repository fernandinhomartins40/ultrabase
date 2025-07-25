#!/bin/bash

# Script rápido para corrigir erro 502 Bad Gateway - Versão atualizada com versionamento
echo "🚀 Corrigindo erro 502 Bad Gateway - Ultrabase"
echo "=============================================="

VPS_HOST="82.25.69.57"
VPS_USER="root"
VERSION_TAG="hotfix-502-$(date +%Y%m%d_%H%M%S)"

# Usar SSH com verificação de host desabilitada
SSH_OPTS="-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null"

echo "📡 Conectando ao servidor para corrigir erro 502..."
echo "🏷️ Versão do hotfix: $VERSION_TAG"

ssh $SSH_OPTS $VPS_USER@$VPS_HOST << EOF

echo "🔧 Iniciando correção do erro 502..."
echo "🏷️ Versão: $VERSION_TAG"

# Criar backup da configuração atual
BACKUP_DIR="/opt/supabase-manager-backups"
mkdir -p "\$BACKUP_DIR"
BACKUP_PATH="\$BACKUP_DIR/\$VERSION_TAG"
mkdir -p "\$BACKUP_PATH"

echo "📦 Criando backup de emergência..."
if [ -f "/opt/supabase-manager/src/instances.json" ]; then
    cp "/opt/supabase-manager/src/instances.json" "\$BACKUP_PATH/instances.json"
fi

# Parar todos os serviços conflitantes
echo "⏹️ Parando serviços conflitantes..."
docker compose -f /opt/supabase-manager/src/docker/docker-compose.production.yml down 2>/dev/null || true
pm2 stop supabase-manager 2>/dev/null || true
pm2 delete supabase-manager 2>/dev/null || true

# Matar processos na porta 3080 se existirem
echo "🔫 Limpando porta 3080..."
sudo lsof -ti:3080 | xargs -r kill -9 2>/dev/null || true

# Atualizar código
echo "📥 Atualizando código..."
cd /opt/supabase-manager
git fetch origin
git reset --hard origin/main
git clean -fd

# Restaurar configuração das instâncias
if [ -f "\$BACKUP_PATH/instances.json" ]; then
    cp "\$BACKUP_PATH/instances.json" src/instances.json
    echo "✅ Configurações de instâncias restauradas"
fi

# Instalar dependências
echo "📦 Verificando dependências..."
cd src
if [ ! -f "node_modules/.package-json.timestamp" ] || [ package.json -nt node_modules/.package-json.timestamp ]; then
    npm install --production
    touch node_modules/.package-json.timestamp
fi

# Escolher método de deploy: Docker Compose (preferido) ou PM2 (fallback)
echo "🤖 Tentando deploy com Docker Compose..."
cd docker

# Verificar se Docker está funcionando
if docker info >/dev/null 2>&1; then
    echo "✅ Docker disponível - Usando Docker Compose"
    
    # Construir e iniciar containers
    docker compose -f docker-compose.production.yml up -d --build --force-recreate
    
    # Aguardar containers ficarem prontos
    echo "⏳ Aguardando containers iniciarem (60 segundos)..."
    sleep 60
    
    # Verificar se containers estão rodando
    if docker ps | grep -q "supabase-instance-manager\|supabase-manager-nginx"; then
        echo "✅ Containers iniciados com sucesso"
        DEPLOY_METHOD="docker"
    else
        echo "❌ Containers falharam - Usando fallback PM2"
        docker compose -f docker-compose.production.yml down 2>/dev/null || true
        DEPLOY_METHOD="pm2"
    fi
else
    echo "❌ Docker não disponível - Usando PM2"
    DEPLOY_METHOD="pm2"
fi

# Fallback para PM2 se Docker falhar
if [ "\$DEPLOY_METHOD" = "pm2" ]; then
    echo "🚀 Iniciando com PM2..."
    cd /opt/supabase-manager/src
    
    # Instalar PM2 se necessário
    if ! command -v pm2 >/dev/null 2>&1; then
        npm install -g pm2
    fi
    
    # Iniciar aplicação
    pm2 start server.js --name supabase-manager || pm2 restart supabase-manager
    
    # Instalar nginx local se necessário (para PM2)
    if ! command -v nginx >/dev/null 2>&1; then
        echo "📦 Instalando nginx..."
        apt update && apt install -y nginx
    fi
    
    # Configurar nginx para PM2
    cp docker/nginx.conf /etc/nginx/nginx.conf
    systemctl restart nginx
    systemctl enable nginx
fi

# Aguardar serviços ficarem prontos
echo "⏳ Aguardando 30 segundos para estabilização..."
sleep 30

# Verificar status final
echo "🔍 Verificando status dos serviços..."

if [ "\$DEPLOY_METHOD" = "docker" ]; then
    echo "📊 Status dos containers:"
    docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
    
    echo "📋 Últimos logs do nginx:"
    docker logs supabase-manager-nginx --tail 5 2>/dev/null || true
    
    echo "📋 Últimos logs da aplicação:"
    docker logs supabase-instance-manager --tail 5 2>/dev/null || true
else
    echo "📊 Status do PM2:"
    pm2 list | grep supabase-manager || echo "PM2 não encontrado"
    
    echo "📊 Status do nginx:"
    systemctl status nginx --no-pager -l || echo "Nginx não encontrado"
fi

# Testar conectividade
echo "🌐 Testando conectividade..."

# Teste local
if curl -s -f http://localhost/ >/dev/null 2>&1; then
    echo "✅ Servidor local respondendo (porta 80)"
else
    echo "❌ Servidor local não responde (porta 80)"
fi

if curl -s -f http://localhost:3080/api/health >/dev/null 2>&1; then
    echo "✅ API respondendo (porta 3080)"
else
    echo "❌ API não responde (porta 3080)"
fi

# Teste externo
if curl -s -f http://82.25.69.57/ >/dev/null 2>&1; then
    echo "✅ Acesso externo funcionando"
else
    echo "❌ Acesso externo não funciona"
fi

# Verificar firewall
echo "🔥 Verificando firewall..."
iptables -L INPUT | grep -E "80|3080" || echo "Sem regras específicas para portas 80/3080"

# Resultado final
echo ""
echo "🎯 RESULTADO DA CORREÇÃO"
echo "========================"
echo "🏷️ Versão: $VERSION_TAG"
echo "🚀 Método: \$DEPLOY_METHOD"
echo "📦 Backup: \$BACKUP_PATH"
echo ""
echo "🌐 URLs para teste:"
echo "   - Principal: http://82.25.69.57"
echo "   - API: http://82.25.69.57:3080"
echo "   - Health: http://82.25.69.57:3080/api/health"
echo ""
echo "🔄 Para rollback se necessário:"
echo "   bash scripts/deploy-versioning.sh rollback $VERSION_TAG"

EOF

echo ""
echo "✅ Correção do erro 502 concluída!"
echo "🌐 Teste a aplicação em: http://$VPS_HOST"
echo "🏷️ Versão do hotfix: $VERSION_TAG" 