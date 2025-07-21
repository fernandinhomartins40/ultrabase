#!/bin/bash

# =============================================================================
# SUPABASE INSTANCE GENERATOR - Modified for supabase-manager integration
# =============================================================================

# Check if running from supabase-manager (has external credentials)
if [ -n "$MANAGER_INSTANCE_ID" ]; then
    echo "🔧 Running from supabase-manager with external credentials"
    export INSTANCE_ID="$MANAGER_INSTANCE_ID"
    export POSTGRES_PASSWORD="$MANAGER_POSTGRES_PASSWORD"
    export JWT_SECRET="$MANAGER_JWT_SECRET"
    export ANON_KEY="$MANAGER_ANON_KEY"
    export SERVICE_ROLE_KEY="$MANAGER_SERVICE_ROLE_KEY"
    export DASHBOARD_USERNAME="$MANAGER_DASHBOARD_USERNAME"
    export DASHBOARD_PASSWORD="$MANAGER_DASHBOARD_PASSWORD"
    export PROJECT_NAME="$MANAGER_PROJECT_NAME"
    export ORGANIZATION_NAME="$MANAGER_ORGANIZATION_NAME"
    
    # Use external port configuration
    export POSTGRES_PORT_EXT="$MANAGER_POSTGRES_PORT_EXT"
    export POOLER_PORT_EXT="$MANAGER_POOLER_PORT_EXT"
    export KONG_HTTP_PORT="$MANAGER_KONG_HTTP_PORT"
    export KONG_HTTPS_PORT="$MANAGER_KONG_HTTPS_PORT"
    export ANALYTICS_PORT="$MANAGER_ANALYTICS_PORT"
    
    echo "✅ Using manager-provided credentials and ports"
else
    echo "🔧 Running standalone - generating random credentials"
    # Generate a unique identifier for the instance
    export INSTANCE_ID=$(date +%s)
    
    # Generate random credentials
    export POSTGRES_PASSWORD=$(openssl rand -hex 16)
    export JWT_SECRET=$(openssl rand -hex 32)
    export ANON_KEY="STANDALONE_GENERATED"
    export SERVICE_ROLE_KEY="STANDALONE_GENERATED"
    export DASHBOARD_USERNAME="admin"
    export DASHBOARD_PASSWORD=$(openssl rand -hex 8)
    export PROJECT_NAME="Standalone Project"
    export ORGANIZATION_NAME="Default Organization"
    
    # Generate random ports
    export POSTGRES_PORT_EXT=54$(shuf -i 10-99 -n 1)
    export POOLER_PORT_EXT=65$(shuf -i 10-99 -n 1)
    export KONG_HTTP_PORT=80$(shuf -i 10-99 -n 1)
    export KONG_HTTPS_PORT=84$(shuf -i 10-99 -n 1)
    export ANALYTICS_PORT=40$(shuf -i 10-99 -n 1)
fi
# =============================================================================
# COMMON CONFIGURATION
# =============================================================================

# Fixed internal configuration
export POSTGRES_DB=postgres
export POSTGRES_PORT=5432  # Internal port (fixed)

# Export necessary variables for kong.yml
export SUPABASE_ANON_KEY=${ANON_KEY}
export SUPABASE_SERVICE_KEY=${SERVICE_ROLE_KEY}

# Log the configuration
echo "📋 Instance Configuration:"
echo "   Instance ID: $INSTANCE_ID"
echo "   Project Name: $PROJECT_NAME"
echo "   Organization: $ORGANIZATION_NAME"
echo "   Kong HTTP Port: $KONG_HTTP_PORT"
echo "   Kong HTTPS Port: $KONG_HTTPS_PORT"
echo "   PostgreSQL External Port: $POSTGRES_PORT_EXT"
echo "   Pooler External Port: $POOLER_PORT_EXT"
echo "   Analytics Port: $ANALYTICS_PORT"

# Set values for required variables - Dynamic IP detection
# Use external IP from manager or auto-detect
if [ -n "$MANAGER_EXTERNAL_IP" ]; then
    EXTERNAL_IP="$MANAGER_EXTERNAL_IP"
else
    # Auto-detect external IP (fallback for standalone)
    EXTERNAL_IP=$(curl -s ifconfig.me 2>/dev/null || curl -s ipinfo.io/ip 2>/dev/null || echo "localhost")
fi

export API_EXTERNAL_URL="http://${EXTERNAL_IP}:${KONG_HTTP_PORT}"
export SITE_URL="http://${EXTERNAL_IP}:3000"
export SUPABASE_PUBLIC_URL="http://${EXTERNAL_IP}:${KONG_HTTP_PORT}"
export STUDIO_DEFAULT_ORGANIZATION="${ORGANIZATION_NAME}"
export STUDIO_DEFAULT_PROJECT="${PROJECT_NAME}"

echo "🌐 Using external IP: $EXTERNAL_IP"
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

# =============================================================================
# GENERATE INSTANCE FILES
# =============================================================================

echo "📝 Generating instance configuration files..."

# Substitute variables in .env.template and generate instance-specific .env
echo "   ⚙️ Creating .env-${INSTANCE_ID}"
envsubst < .env.template > .env-${INSTANCE_ID}

# Substitute variables in docker-compose.yml and generate instance-specific docker-compose
echo "   ⚙️ Creating docker-compose-${INSTANCE_ID}.yml"
envsubst < docker-compose.yml > docker-compose-${INSTANCE_ID}.yml

# =============================================================================
# SETUP VOLUME DIRECTORIES
# =============================================================================

echo "📁 Setting up volume directories..."

# Create volume directories for the instance
mkdir -p volumes-${INSTANCE_ID}/functions
mkdir -p volumes-${INSTANCE_ID}/logs
mkdir -p volumes-${INSTANCE_ID}/db/init
mkdir -p volumes-${INSTANCE_ID}/api
mkdir -p volumes-${INSTANCE_ID}/pooler

echo "   ✅ Created volume directories for instance ${INSTANCE_ID}"

# =============================================================================
# COPY CONFIGURATION FILES
# =============================================================================

echo "📋 Copying configuration files..."

## Copy all contents of the db folder, including subdirectories and specific files
if [ -d "volumes/db/" ]; then
  cp -a volumes/db/. volumes-${INSTANCE_ID}/db/
  echo "   ✅ Database configuration copied"
fi

## Copy function files (if any)
if [ -d "volumes/functions/" ]; then
  cp -a volumes/functions/. volumes-${INSTANCE_ID}/functions/
  echo "   ✅ Function files copied"
fi

## Copy pooler configuration
if [ -d "volumes/pooler/" ]; then
  cp -a volumes/pooler/. volumes-${INSTANCE_ID}/pooler/
  echo "   ✅ Pooler configuration copied"
fi

## Substitute variables in vector.yml and copy to the instance directory
if [ -f "volumes/logs/vector.yml" ]; then
  envsubst < volumes/logs/vector.yml > volumes-${INSTANCE_ID}/logs/vector.yml
  echo "   ✅ Vector configuration created"
fi

## Substitute variables in kong.yml and copy to the instance directory
if [ -f "volumes/api/kong.yml" ]; then
  envsubst < volumes/api/kong.yml > volumes-${INSTANCE_ID}/api/kong.yml
  echo "   ✅ Kong configuration created"
else
  echo "❌ Error: File volumes/api/kong.yml not found."
  exit 1
fi

# =============================================================================
# START CONTAINERS
# =============================================================================

echo "🚀 Starting Supabase instance containers..."
echo "   This may take several minutes on first run (downloading images)..."

# Start the instance containers
if docker compose -f docker-compose-${INSTANCE_ID}.yml --env-file .env-${INSTANCE_ID} up -d --pull always; then
    echo "✅ Instance ${INSTANCE_ID} started successfully!"
    echo ""
    echo "🎉 Supabase instance '${PROJECT_NAME}' is ready!"
    echo "📊 Studio URL: http://localhost:${KONG_HTTP_PORT}"
    echo "🔗 API URL: http://localhost:${KONG_HTTP_PORT}"
    echo "🗄️ Database: postgresql://postgres:${POSTGRES_PASSWORD}@localhost:${POSTGRES_PORT_EXT}/postgres"
    echo ""
else
    echo "❌ Failed to start instance ${INSTANCE_ID}"
    echo "📋 Check logs with: docker compose -f docker-compose-${INSTANCE_ID}.yml logs"
    exit 1
fi
