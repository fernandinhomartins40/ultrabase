#!/bin/bash

echo "🚀 Generate.bash adaptado para Supabase Instance Manager - VERSÃO CORRIGIDA"
echo "📁 Executando em: $(pwd)"
echo "🔧 Versão: 2.0.0 - Correção de bugs críticos"

# Função para log detalhado
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
}

# Função para verificar dependências
check_dependencies() {
    log "🔍 Verificando dependências..."
    
    # Verificar bash
    if ! command -v bash >/dev/null 2>&1; then
        log "❌ Bash não encontrado"
        exit 1
    fi
    
    # Verificar openssl
    if ! command -v openssl >/dev/null 2>&1; then
        log "❌ OpenSSL não encontrado"
        exit 1
    fi
    
    # Verificar envsubst
    if ! command -v envsubst >/dev/null 2>&1; then
        log "❌ envsubst não encontrado (instale gettext)"
        exit 1
    fi
    
    log "✅ Todas as dependências verificadas"
}

# Função para detectar IP externo
detect_external_ip() {
    log "🌐 Detectando IP externo..."
    
    local detected_ip=""
    
    # Tentar vários métodos
    if command -v curl >/dev/null 2>&1; then
        detected_ip=$(curl -s --connect-timeout 5 ifconfig.me 2>/dev/null || echo "")
    fi
    
    if [ -z "$detected_ip" ] && command -v wget >/dev/null 2>&1; then
        detected_ip=$(wget -qO- --timeout=5 ifconfig.me 2>/dev/null || echo "")
    fi
    
    if [ -z "$detected_ip" ]; then
        detected_ip=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "")
    fi
    
    if [ -z "$detected_ip" ] || [ "$detected_ip" = "127.0.0.1" ]; then
        detected_ip="0.0.0.0"
        log "⚠️ Usando 0.0.0.0 como fallback"
    fi
    
    echo "$detected_ip"
}

# Função para gerar senha segura
generate_password() {
    openssl rand -hex 16
}

# Função para gerar JWT secret
generate_jwt_secret() {
    openssl rand -hex 32
}

# Função para gerar JWT token
generate_jwt_token() {
    local role=$1
    local secret=$2
    local now=$(date +%s)
    local exp=$((now + 365*24*3600)) # 1 ano
    
    # Usar node.js se disponível, senão usar método alternativo
    if command -v node >/dev/null 2>&1; then
        node -e "
            const jwt = require('jsonwebtoken');
            const payload = {
                role: '$role',
                iss: 'supabase-instance-manager',
                iat: $now,
                exp: $exp
            };
            console.log(jwt.sign(payload, '$secret'));
        " 2>/dev/null || echo "fallback_token_${role}_${secret:0:8}"
    else
        # Fallback simples para desenvolvimento
        echo "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.$(echo -n "{\"role\":\"$role\",\"iss\":\"supabase\",\"iat\":$now,\"exp\":$exp}" | base64 -w 0).signature"
    fi
}

# Função para verificar e criar diretórios
create_directories() {
    local instance_id=$1
    
    log "📁 Criando diretórios para instância $instance_id..."
    
    mkdir -p "volumes-$instance_id"/{functions,logs,db/init,api,storage}
    
    # Verificar criação
    if [ -d "volumes-$instance_id" ]; then
        log "✅ Diretórios criados com sucesso"
    else
        log "❌ Erro ao criar diretórios"
        exit 1
    fi
}

# Função para copiar arquivos base
copy_base_files() {
    local instance_id=$1
    
    log "📋 Copiando arquivos base..."
    
    # Copiar arquivos DB
    if [ -d "volumes/db/" ]; then
        cp -a volumes/db/. "volumes-$instance_id/db/"
        log "✅ Arquivos DB copiados"
    fi
    
    # Copiar functions
    if [ -d "volumes/functions/" ]; then
        cp -a volumes/functions/. "volumes-$instance_id/functions/"
        log "✅ Arquivos Functions copiados"
    fi
    
    # Processar vector.yml
    if [ -f "volumes/logs/vector.yml" ]; then
        envsubst < volumes/logs/vector.yml > "volumes-$instance_id/logs/vector.yml"
        log "✅ Vector.yml processado"
    fi
    
    # Processar kong.yml
    if [ -f "volumes/api/kong.yml" ]; then
        envsubst < volumes/api/kong.yml > "volumes-$instance_id/api/kong.yml"
        log "✅ Kong.yml processado"
    else
        log "❌ Kong.yml não encontrado"
        exit 1
    fi
}

# Função principal de criação
create_instance() {
    local instance_id=$1
    local project_name=$2
    
    log "🎯 Iniciando criação da instância $instance_id"
    
    # Verificar arquivos necessários
    if [ ! -f ".env.template" ]; then
        log "❌ .env.template não encontrado"
        exit 1
    fi
    
    if [ ! -f "docker-compose.yml" ]; then
        log "❌ docker-compose.yml não encontrado"
        exit 1
    fi
    
    # Criar diretórios
    create_directories "$instance_id"
    
    # Copiar arquivos
    copy_base_files "$instance_id"
    
    # Gerar arquivos de configuração
    log "⚙️ Gerando arquivos de configuração..."
    
    envsubst < .env.template > ".env-$instance_id"
    envsubst < docker-compose.yml > "docker-compose-$instance_id.yml"
    
    log "✅ Arquivos de configuração gerados"
}

# Início do script
log "🚀 Iniciando script de geração de instância Supabase"

# Verificar dependências
check_dependencies

# Se variáveis do Manager foram passadas, usar elas
if [ -n "$MANAGER_INSTANCE_ID" ]; then
    log "🎯 Modo GERENCIADO - Usando configurações do Manager"
    
    INSTANCE_ID=$MANAGER_INSTANCE_ID
    PROJECT_NAME=${MANAGER_PROJECT_NAME:-"Generated-$INSTANCE_ID"}
    POSTGRES_PASSWORD=${MANAGER_POSTGRES_PASSWORD:-$(generate_password)}
    JWT_SECRET=${MANAGER_JWT_SECRET:-$(generate_jwt_secret)}
    
    # Gerar tokens JWT únicos
    ANON_KEY=${MANAGER_ANON_KEY:-$(generate_jwt_token "anon" "$JWT_SECRET")}
    SERVICE_ROLE_KEY=${MANAGER_SERVICE_ROLE_KEY:-$(generate_jwt_token "service_role" "$JWT_SECRET")}
    
    DASHBOARD_USERNAME=${MANAGER_DASHBOARD_USERNAME:-"admin"}
    DASHBOARD_PASSWORD=${MANAGER_DASHBOARD_PASSWORD:-"admin"}
    
    # Portas do manager
    POSTGRES_PORT_EXT=${MANAGER_POSTGRES_PORT_EXT:-54$(shuf -i 10-99 -n 1)}
    KONG_HTTP_PORT=${MANAGER_KONG_HTTP_PORT:-80$(shuf -i 10-99 -n 1)}
    KONG_HTTPS_PORT=${MANAGER_KONG_HTTPS_PORT:-84$(shuf -i 10-99 -n 1)}
    ANALYTICS_PORT=${MANAGER_ANALYTICS_PORT:-40$(shuf -i 10-99 -n 1)}
    
    # IP externo
    EXTERNAL_IP=${MANAGER_EXTERNAL_IP:-$(detect_external_ip)}
    
    log "✅ Configurações do Manager aplicadas"
    
else
    # Modo standalone
    log "🎯 Modo STANDALONE - Gerando configurações locais"
    
    INSTANCE_ID=${INSTANCE_ID:-$(date +%s)}
    PROJECT_NAME=${PROJECT_NAME:-"Project-$INSTANCE_ID"}
    POSTGRES_PASSWORD=$(generate_password)
    JWT_SECRET=$(generate_jwt_secret)
    
    ANON_KEY=$(generate_jwt_token "anon" "$JWT_SECRET")
    SERVICE_ROLE_KEY=$(generate_jwt_token "service_role" "$JWT_SECRET")
    
    DASHBOARD_USERNAME="admin"
    DASHBOARD_PASSWORD=$(generate_password)
    
    POSTGRES_PORT_EXT=54$(shuf -i 10-99 -n 1)
    KONG_HTTP_PORT=80$(shuf -i 10-99 -n 1)
    KONG_HTTPS_PORT=84$(shuf -i 10-99 -n 1)
    ANALYTICS_PORT=40$(shuf -i 10-99 -n 1)
    
    EXTERNAL_IP=$(detect_external_ip)
fi

# Exportar todas as variáveis necessárias
export INSTANCE_ID
export POSTGRES_PASSWORD
export JWT_SECRET
export ANON_KEY
export SERVICE_ROLE_KEY
export DASHBOARD_USERNAME
export DASHBOARD_PASSWORD
export POSTGRES_DB=postgres
export POSTGRES_PORT=5432
export POSTGRES_PORT_EXT
export KONG_HTTP_PORT
export KONG_HTTPS_PORT
export ANALYTICS_PORT
export API_EXTERNAL_URL="http://${EXTERNAL_IP}:${KONG_HTTP_PORT}"
export SITE_URL="http://${EXTERNAL_IP}:3000"
export SUPABASE_PUBLIC_URL="http://${EXTERNAL_IP}:${KONG_HTTP_PORT}"
export STUDIO_DEFAULT_ORGANIZATION="${PROJECT_NAME}"
export STUDIO_DEFAULT_PROJECT="${PROJECT_NAME}"
export SUPABASE_ANON_KEY="${ANON_KEY}"
export SUPABASE_SERVICE_KEY="${SERVICE_ROLE_KEY}"
export ENABLE_EMAIL_SIGNUP="true"
export ENABLE_EMAIL_AUTOCONFIRM="true"
export SMTP_ADMIN_EMAIL="admin@example.com"
export SMTP_HOST="supabase-mail"
export SMTP_PORT=2500
export SMTP_USER="fake_mail_user"
export SMTP_PASS="fake_mail_password"
export SMTP_SENDER_NAME="fake_sender"
export ENABLE_ANONYMOUS_USERS="true"
export JWT_EXPIRY=3600
export DISABLE_SIGNUP="false"
export IMGPROXY_ENABLE_WEBP_DETECTION="true"
export FUNCTIONS_VERIFY_JWT="false"
export DOCKER_SOCKET_LOCATION="/var/run/docker.sock"
export LOGFLARE_API_KEY="fake_logflare_key"
export LOGFLARE_LOGGER_BACKEND_API_KEY="fake_logflare_key"
export PGRST_DB_SCHEMAS="public,storage,graphql_public"

# Criar instância
create_instance "$INSTANCE_ID" "$PROJECT_NAME"

# Verificar criação
if [ -f ".env-$INSTANCE_ID" ] && [ -f "docker-compose-$INSTANCE_ID.yml" ] && [ -d "volumes-$INSTANCE_ID" ]; then
    log "✅ INSTÂNCIA CRIADA COM SUCESSO!"
    log "📋 Resumo:"
    log "   Instance ID: $INSTANCE_ID"
    log "   Project: $PROJECT_NAME"
    log "   Kong HTTP: $EXTERNAL_IP:$KONG_HTTP_PORT"
    log "   Studio: http://$EXTERNAL_IP:$KONG_HTTP_PORT"
    log "   Database: postgresql://postgres:$POSTGRES_PASSWORD@$EXTERNAL_IP:$POSTGRES_PORT_EXT/postgres"
    
    # Iniciar containers se Docker disponível
    if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
        log "🐳 Iniciando containers Docker..."
        if docker compose -f "docker-compose-$INSTANCE_ID.yml" --env-file ".env-$INSTANCE_ID" up -d; then
            log "✅ Containers iniciados com sucesso!"
        else
            log "⚠️ Erro ao iniciar containers, mas arquivos criados"
        fi
    else
        log "⚠️ Docker não disponível, arquivos criados para uso posterior"
    fi
    
    exit 0
else
    log "❌ Erro na criação da instância"
    exit 1
fi
