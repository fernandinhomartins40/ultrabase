#!/bin/bash

# Script para configurar VPS limpa e executar deploy
echo "🚀 Configurando VPS limpa e executando deploy - Ultrabase"
echo "========================================================"

VPS_HOST="82.25.69.57"
VPS_USER="root"
VERSION_TAG="hotfix-vps-limpa-$(date +%Y%m%d_%H%M%S)"

# Usar SSH com verificação de host desabilitada
SSH_OPTS="-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null"

echo "📡 Conectando à VPS limpa..."
echo "🏷️ Versão: $VERSION_TAG"

ssh $SSH_OPTS $VPS_USER@$VPS_HOST << EOF

echo "🔧 Configurando VPS limpa..."
echo "🏷️ Versão: $VERSION_TAG"

# Atualizar sistema
echo "📦 Atualizando sistema..."
apt update

# Instalar dependências básicas
echo "📦 Instalando dependências básicas..."
apt install -y curl git jq lsof

# Instalar Node.js e npm
echo "📦 Instalando Node.js..."
curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
apt install -y nodejs

# Instalar PM2
echo "📦 Instalando PM2..."
npm install -g pm2

# Instalar Docker (opcional, para fallback)
echo "📦 Instalando Docker..."
curl -fsSL https://get.docker.com -o get-docker.sh
sh get-docker.sh || echo "⚠️ Docker falhou, continuando com PM2"
systemctl start docker 2>/dev/null || true
systemctl enable docker 2>/dev/null || true

# Instalar nginx
echo "📦 Instalando nginx..."
apt install -y nginx

# Criar diretórios
echo "📁 Criando estrutura de diretórios..."
mkdir -p /opt/supabase-manager
mkdir -p /opt/supabase-manager-backups

# Clonar repositório
echo "📥 Clonando repositório..."
cd /opt/supabase-manager
git clone https://github.com/fernandinhomartins40/ultrabase.git . || {
    echo "❌ Falha ao clonar repositório"
    exit 1
}

# Instalar dependências
echo "📦 Instalando dependências do projeto..."
cd src
npm install --production

# Configurar nginx
echo "🔧 Configurando nginx..."
cp docker/nginx.conf /etc/nginx/nginx.conf

# Iniciar aplicação com PM2
echo "🚀 Iniciando aplicação..."
pm2 start server.js --name supabase-manager

# Iniciar nginx
echo "🌐 Iniciando nginx..."
systemctl restart nginx
systemctl enable nginx

# Aguardar serviços ficarem prontos
echo "⏳ Aguardando serviços ficarem prontos..."
sleep 15

# Verificar status
echo "🔍 Verificando status dos serviços..."

echo "📊 Status do PM2:"
pm2 list | grep supabase-manager || echo "PM2 não encontrado"

echo "📊 Status do nginx:"
systemctl status nginx --no-pager -l | head -3 || echo "Nginx não encontrado"

echo "📊 Status do Docker:"
if command -v docker >/dev/null 2>&1; then
    if docker info >/dev/null 2>&1; then
        echo "✅ Docker disponível"
    else
        echo "⚠️ Docker instalado mas não funcionando"
    fi
else
    echo "❌ Docker não instalado"
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
    echo "📋 Verificando logs da aplicação:"
    pm2 logs supabase-manager --lines 5 || true
fi

# Teste externo
if curl -s -f http://82.25.69.57/ >/dev/null 2>&1; then
    echo "✅ Acesso externo funcionando"
else
    echo "❌ Acesso externo não funciona"
fi

# Verificar portas abertas
echo "🔍 Verificando portas abertas:"
netstat -tlnp | grep -E ":80|:3080|:443" || echo "Nenhuma porta web encontrada"

# Resultado final
echo ""
echo "🎯 RESULTADO DA CONFIGURAÇÃO VPS LIMPA"
echo "======================================"
echo "🏷️ Versão: $VERSION_TAG"
echo "🖥️ Sistema: \$(uname -a)"
echo "📦 Node.js: \$(node --version 2>/dev/null || echo 'Não instalado')"
echo "📦 npm: \$(npm --version 2>/dev/null || echo 'Não instalado')"
echo "📦 PM2: \$(pm2 --version 2>/dev/null || echo 'Não instalado')"
echo "📦 Docker: \$(docker --version 2>/dev/null || echo 'Não instalado')"
echo "📦 nginx: \$(nginx -v 2>&1 | head -1 || echo 'Não instalado')"
echo ""
echo "🌐 URLs para teste:"
echo "   - Principal: http://82.25.69.57"
echo "   - API: http://82.25.69.57:3080"
echo "   - Health: http://82.25.69.57:3080/api/health"
echo ""
echo "📋 Próximos passos:"
echo "   - Testar URLs acima"
echo "   - Executar novo deploy via GitHub Actions se necessário"
echo "   - Verificar logs com: pm2 logs supabase-manager"

EOF

echo ""
echo "✅ Configuração da VPS limpa concluída!"
echo "🌐 Teste a aplicação em: http://$VPS_HOST"
echo "🏷️ Versão: $VERSION_TAG" 