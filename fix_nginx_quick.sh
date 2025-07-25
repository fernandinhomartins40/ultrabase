#!/bin/bash

# Script rápido para corrigir nginx na VPS
echo "🔧 Corrigindo nginx na VPS..."

VPS_HOST="82.25.69.57"
VPS_USER="root"

# SSH ignorando verificação de host
SSH_OPTS="-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null"

ssh $SSH_OPTS $VPS_USER@$VPS_HOST << 'EOF'

echo "🔍 Diagnosticando problema do nginx..."

# Verificar erro específico
echo "📋 Testando configuração atual:"
nginx -t

echo "📋 Logs de erro do nginx:"
journalctl -u nginx.service --no-pager -l | tail -10

echo "🔧 Criando configuração nginx simplificada..."

# Backup da configuração atual
cp /etc/nginx/nginx.conf /etc/nginx/nginx.conf.backup

# Criar configuração nginx simples que funciona
cat > /etc/nginx/nginx.conf << 'NGINX_CONFIG'
user www-data;
worker_processes auto;
pid /run/nginx.pid;

events {
    worker_connections 768;
}

http {
    sendfile on;
    tcp_nopush on;
    tcp_nodelay on;
    keepalive_timeout 65;
    types_hash_max_size 2048;

    include /etc/nginx/mime.types;
    default_type application/octet-stream;

    access_log /var/log/nginx/access.log;
    error_log /var/log/nginx/error.log;

    gzip on;

    # Upstream para a aplicação
    upstream supabase_manager {
        server localhost:3080;
    }

    # Servidor principal
    server {
        listen 80;
        server_name _;

        # Proxy para a aplicação
        location / {
            proxy_pass http://supabase_manager;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection 'upgrade';
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_cache_bypass $http_upgrade;
        }

        # Health check
        location /health {
            return 200 'OK';
            add_header Content-Type text/plain;
        }
    }
}
NGINX_CONFIG

echo "🔍 Testando nova configuração:"
nginx -t

if [ $? -eq 0 ]; then
    echo "✅ Configuração válida, reiniciando nginx..."
    systemctl restart nginx
    systemctl enable nginx
    
    # Verificar status
    systemctl status nginx --no-pager
    
    echo "🌐 Testando conectividade:"
    sleep 3
    
    if curl -s http://localhost/ >/dev/null; then
        echo "✅ Nginx funcionando!"
    else
        echo "❌ Nginx ainda não responde"
    fi
    
    # Testar aplicação
    if curl -s http://localhost:3080/api/health >/dev/null; then
        echo "✅ Aplicação funcionando!"
    else
        echo "❌ Aplicação não responde"
    fi
    
else
    echo "❌ Configuração inválida, restaurando backup..."
    cp /etc/nginx/nginx.conf.backup /etc/nginx/nginx.conf
fi

echo "📊 Status final dos serviços:"
echo "PM2:"
pm2 list | grep supabase-manager || echo "PM2 não encontrado"

echo "Nginx:"
systemctl is-active nginx && echo "Nginx ativo" || echo "Nginx inativo"

echo "Portas abertas:"
netstat -tlnp | grep -E ":80|:3080" || echo "Nenhuma porta encontrada"

EOF

echo "✅ Correção do nginx concluída!" 