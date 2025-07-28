#!/bin/bash

# Script para configurar domínio ultrabase.com.br na VPS
# Execute como root na VPS

set -e

DOMAIN="ultrabase.com.br"
APP_PORT="3080"
NGINX_CONFIG="/etc/nginx/sites-available/ultrabase"
NGINX_ENABLED="/etc/nginx/sites-enabled/ultrabase"

echo "🌐 Configurando domínio $DOMAIN para Ultrabase..."

# Verificar se é root
if [ "$EUID" -ne 0 ]; then
    echo "❌ Este script precisa ser executado como root"
    echo "Use: sudo bash setup-domain.sh"
    exit 1
fi

# Atualizar sistema
echo "📦 Atualizando sistema..."
apt update

# Instalar Nginx se não estiver instalado
if ! command -v nginx &> /dev/null; then
    echo "📦 Instalando Nginx..."
    apt install -y nginx
fi

# Instalar Certbot se não estiver instalado
if ! command -v certbot &> /dev/null; then
    echo "🔒 Instalando Certbot para SSL..."
    apt install -y certbot python3-certbot-nginx
fi

# Verificar se a aplicação está rodando
echo "🔍 Verificando se a aplicação está rodando na porta $APP_PORT..."
if ! ss -tlnp | grep ":$APP_PORT " > /dev/null; then
    echo "⚠️  Aplicação não encontrada na porta $APP_PORT"
    echo "📝 Você precisa iniciar a aplicação Ultrabase primeiro:"
    echo "   cd /opt/supabase-manager/src"
    echo "   pm2 start server.js --name ultrabase-manager"
    echo ""
    echo "🔧 Continuando com a configuração do Nginx..."
fi

# Criar configuração do Nginx (temporária sem SSL)
echo "⚙️  Criando configuração temporária do Nginx..."
cat > $NGINX_CONFIG << EOF
# Configuração temporária para obter certificado SSL
server {
    listen 80;
    server_name $DOMAIN www.$DOMAIN;
    
    location / {
        proxy_pass http://localhost:$APP_PORT;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
    }
}
EOF

# Habilitar site
echo "🔗 Habilitando configuração do Nginx..."
ln -sf $NGINX_CONFIG $NGINX_ENABLED

# Remover configuração padrão se existir
if [ -f "/etc/nginx/sites-enabled/default" ]; then
    echo "🗑️  Removendo configuração padrão do Nginx..."
    rm -f /etc/nginx/sites-enabled/default
fi

# Testar configuração do Nginx
echo "🧪 Testando configuração do Nginx..."
nginx -t

# Recarregar Nginx
echo "🔄 Recarregando Nginx..."
systemctl reload nginx

# Habilitar Nginx para iniciar automaticamente
systemctl enable nginx

echo "✅ Nginx configurado com sucesso!"

# Verificar se o domínio está apontando para o servidor
echo "🔍 Verificando DNS do domínio..."
DOMAIN_IP=$(dig +short $DOMAIN)
SERVER_IP=$(curl -s http://ipv4.icanhazip.com)

if [ "$DOMAIN_IP" = "$SERVER_IP" ]; then
    echo "✅ DNS configurado corretamente!"
    echo "🌐 $DOMAIN → $SERVER_IP"
else
    echo "⚠️  DNS pode não estar configurado corretamente:"
    echo "   Domínio aponta para: $DOMAIN_IP"
    echo "   Servidor IP: $SERVER_IP"
    echo ""
    echo "📝 Aguarde alguns minutos para propagação do DNS antes de continuar"
fi

# Solicitar certificado SSL
echo "🔒 Configurando certificado SSL..."
echo "📝 O Certbot irá solicitar algumas informações..."

if certbot --nginx -d $DOMAIN -d www.$DOMAIN --non-interactive --agree-tos --email admin@$DOMAIN --redirect; then
    echo "✅ Certificado SSL configurado com sucesso!"
else
    echo "⚠️  Não foi possível obter certificado SSL automaticamente"
    echo "📝 Isso pode ser devido ao DNS não estar propagado ainda"
    echo "🔧 Você pode tentar novamente mais tarde com:"
    echo "   sudo certbot --nginx -d $DOMAIN -d www.$DOMAIN"
fi

# Configurar renovação automática
echo "🔄 Configurando renovação automática do certificado..."
if ! crontab -l 2>/dev/null | grep -q "certbot renew"; then
    (crontab -l 2>/dev/null; echo "0 12 * * * /usr/bin/certbot renew --quiet") | crontab -
    echo "✅ Renovação automática configurada!"
fi

# Verificar status dos serviços
echo "📊 Status dos serviços:"
echo "   Nginx: $(systemctl is-active nginx)"
echo "   Aplicação na porta $APP_PORT: $(ss -tlnp | grep ":$APP_PORT " > /dev/null && echo "✅ Rodando" || echo "❌ Parada")"

# Teste final
echo "🧪 Testando conectividade..."
if curl -s -o /dev/null -w "%{http_code}" http://localhost:$APP_PORT | grep -q "200"; then
    echo "✅ Aplicação respondendo localmente"
    echo "🌐 Teste o domínio: https://$DOMAIN"
else
    echo "❌ Aplicação não está respondendo na porta $APP_PORT"
    echo "📝 Verifique se a aplicação está rodando:"
    echo "   sudo pm2 status"
    echo "   sudo pm2 logs ultrabase-manager"
fi

echo ""
echo "🎉 Configuração concluída!"
echo "📝 Próximos passos:"
echo "   1. Certifique-se de que a aplicação Ultrabase está rodando"
echo "   2. Teste: https://$DOMAIN"
echo "   3. Verifique logs se houver problemas:"
echo "      - Nginx: sudo tail -f /var/log/nginx/error.log"
echo "      - Aplicação: sudo pm2 logs ultrabase-manager"
echo ""