#!/bin/bash

echo "🚀 Generate.bash adaptado para Supabase Instance Manager"
echo "📁 Executando em: $(pwd)"

# Se variáveis do Manager foram passadas, usar elas; senão usar valores padrão
if [ -n "$MANAGER_INSTANCE_ID" ]; then
  # Modo gerenciado: usar valores do manager
  echo "🎯 Modo GERENCIADO - Usando configurações do Manager"
  
  # Usar Manager ID como INSTANCE_ID
  INSTANCE_ID=$MANAGER_INSTANCE_ID
  PROJECT_NAME=$MANAGER_PROJECT_NAME
  POSTGRES_PASSWORD=$MANAGER_POSTGRES_PASSWORD
  JWT_SECRET=$MANAGER_JWT_SECRET  
  ANON_KEY=$MANAGER_ANON_KEY
  SERVICE_ROLE_KEY=$MANAGER_SERVICE_ROLE_KEY
  DASHBOARD_USERNAME=$MANAGER_DASHBOARD_USERNAME
  DASHBOARD_PASSWORD=$MANAGER_DASHBOARD_PASSWORD
  
  # Portas do manager
  POSTGRES_PORT_EXT=$MANAGER_POSTGRES_PORT_EXT
  KONG_HTTP_PORT=$MANAGER_KONG_HTTP_PORT
  KONG_HTTPS_PORT=$MANAGER_KONG_HTTPS_PORT
  ANALYTICS_PORT=$MANAGER_ANALYTICS_PORT
  
  # IP externo do manager
  EXTERNAL_IP=$MANAGER_EXTERNAL_IP
  
  echo "✅ Configurações recebidas do Manager:"
  echo "   - Instance ID: $INSTANCE_ID"
  echo "   - Project: $PROJECT_NAME"  
  echo "   - Kong HTTP Port: $KONG_HTTP_PORT"
  echo "   - External IP: $EXTERNAL_IP"

else
  # Modo standalone: usar comportamento original
  echo "🎯 Modo STANDALONE - Gerando configurações aleatórias"
  
  # Generate a unique identifier for the instance
  INSTANCE_ID=$(date +%s)
  
  # Generate other necessary variables
  POSTGRES_PASSWORD=$(openssl rand -hex 16)
  JWT_SECRET=9f878Nhjk3TJyVKgyaGh83hh6Pu9j9yfxnZSuphb
  ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.ewogICJyb2xlIjogImFub24iLAogICJpc3MiOiAic3VwYWJhc2UiLAogICJpYXQiOiAxNzI3MjMzMjAwLAogICJleHAiOiAxODg0OTk5NjAwCn0.O0qBbl300xfJrhmW3YktijUJQ5ZW6OXVyZjnSwSCzCg
  SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.ewogICJyb2xlIjogInNlcnZpY2Vfcm9sZSIsCiAgImlzcyI6ICJzdXBhYmFzZSIsCiAgImlhdCI6IDE3MjcyMzMyMDAsCiAgImV4cCI6IDE4ODQ5OTk2MDAKfQ.7KpglgDbGij2ich1kiVbzBj6Znz_S5anWm0iOemyS18
  
  DASHBOARD_USERNAME=admin
  DASHBOARD_PASSWORD=$(openssl rand -hex 8)
  
  # Generate random non-conflicting ports
  POSTGRES_PORT_EXT=54$(shuf -i 10-99 -n 1) 
  KONG_HTTP_PORT=80$(shuf -i 10-99 -n 1)
  KONG_HTTPS_PORT=84$(shuf -i 10-99 -n 1)
  ANALYTICS_PORT=40$(shuf -i 10-99 -n 1)
  
  EXTERNAL_IP="0.0.0.0"
fi

# Export INSTANCE_ID so it can be used in envsubst
export INSTANCE_ID

# Export todas as variáveis necessárias
export POSTGRES_PASSWORD
export JWT_SECRET
export ANON_KEY  
export SERVICE_ROLE_KEY
export DASHBOARD_USERNAME
export DASHBOARD_PASSWORD
export POSTGRES_DB=postgres

# Export necessary variables for kong.yml
export SUPABASE_ANON_KEY=${ANON_KEY}
export SUPABASE_SERVICE_KEY=${SERVICE_ROLE_KEY}

# Portas
export POSTGRES_PORT=5432
export POSTGRES_PORT_EXT
export KONG_HTTP_PORT
export KONG_HTTPS_PORT
export ANALYTICS_PORT

# URLs com IP dinâmico
export API_EXTERNAL_URL="http://${EXTERNAL_IP}:${KONG_HTTP_PORT}"
export SITE_URL="http://${EXTERNAL_IP}:3000" 
export SUPABASE_PUBLIC_URL="http://${EXTERNAL_IP}:${KONG_HTTP_PORT}"
export STUDIO_DEFAULT_ORGANIZATION="${PROJECT_NAME:-YourOrganization}"
export STUDIO_DEFAULT_PROJECT="${PROJECT_NAME:-YourProject}"

# Outras configurações
export ENABLE_EMAIL_SIGNUP="true"
export ENABLE_EMAIL_AUTOCONFIRM="true"
export SMTP_ADMIN_EMAIL="your_email"
export SMTP_HOST="your_smtp_host"
export SMTP_PORT=2500
export SMTP_USER="your_smtp_user"
export SMTP_PASS="your_smtp_pass"
export SMTP_SENDER_NAME="your_sender_name"
export ENABLE_ANONYMOUS_USERS="true"
export JWT_EXPIRY=3600
export DISABLE_SIGNUP="false"
export IMGPROXY_ENABLE_WEBP_DETECTION="true"
export FUNCTIONS_VERIFY_JWT="false"
export DOCKER_SOCKET_LOCATION="/var/run/docker.sock"
export LOGFLARE_API_KEY="your_logflare_key"
export LOGFLARE_LOGGER_BACKEND_API_KEY="your_logflare_key"
export PGRST_DB_SCHEMAS=public,storage,graphql_public

echo "🔧 Processando templates..."

# Substitute variables in .env.template and generate instance-specific .env
if [ -f ".env.template" ]; then
  envsubst < .env.template > .env-${INSTANCE_ID}
  echo "✅ Arquivo .env-${INSTANCE_ID} criado"
else
  echo "❌ ERRO: .env.template não encontrado"
  exit 1
fi

# Substitute variables in docker-compose.yml and generate instance-specific docker-compose
if [ -f "docker-compose.yml" ]; then
  envsubst < docker-compose.yml > docker-compose-${INSTANCE_ID}.yml
  echo "✅ Arquivo docker-compose-${INSTANCE_ID}.yml criado"
else
  echo "❌ ERRO: docker-compose.yml não encontrado"
  exit 1
fi

echo "📁 Criando diretórios de volumes..."

# Create volume directories for the instance
mkdir -p volumes-${INSTANCE_ID}/functions
mkdir -p volumes-${INSTANCE_ID}/logs
mkdir -p volumes-${INSTANCE_ID}/db/init
mkdir -p volumes-${INSTANCE_ID}/api

# Copy necessary files to volume directories
echo "📋 Copiando arquivos base..."

## Copy all contents of the db folder, including subdirectories and specific files
if [ -d "volumes/db/" ]; then
  cp -a volumes/db/. volumes-${INSTANCE_ID}/db/
  echo "✅ Arquivos DB copiados"
fi

## Copy function files (if any)
if [ -d "volumes/functions/" ]; then
  cp -a volumes/functions/. volumes-${INSTANCE_ID}/functions/
  echo "✅ Arquivos Functions copiados"
fi

## Substitute variables in vector.yml and copy to the instance directory
if [ -f "volumes/logs/vector.yml" ]; then
  envsubst < volumes/logs/vector.yml > volumes-${INSTANCE_ID}/logs/vector.yml
  echo "✅ Vector.yml processado"
fi

## Substitute variables in kong.yml and copy to the instance directory
if [ -f "volumes/api/kong.yml" ]; then
  envsubst < volumes/api/kong.yml > volumes-${INSTANCE_ID}/api/kong.yml
  echo "✅ Kong.yml processado"
else
  echo "❌ ERRO: File volumes/api/kong.yml not found."
  exit 1
fi

echo "🐳 Iniciando containers Docker..."

# Start the instance containers
docker compose -f docker-compose-${INSTANCE_ID}.yml --env-file .env-${INSTANCE_ID} up -d

echo "✅ INSTÂNCIA CRIADA COM SUCESSO!"
echo ""
echo "📋 Informações da Instância:"
echo "   Instance ID: ${INSTANCE_ID}"
echo "   Project Name: ${PROJECT_NAME:-'Generated-'$INSTANCE_ID}"
echo "   Kong HTTP: ${EXTERNAL_IP}:${KONG_HTTP_PORT}"
echo "   Kong HTTPS: ${EXTERNAL_IP}:${KONG_HTTPS_PORT}"
echo "   Studio URL: http://${EXTERNAL_IP}:${KONG_HTTP_PORT}"
echo "   Dashboard User: ${DASHBOARD_USERNAME}"
echo "   Dashboard Pass: ${DASHBOARD_PASSWORD}"
echo ""
echo "🎯 Acesse o Studio em: http://${EXTERNAL_IP}:${KONG_HTTP_PORT}"