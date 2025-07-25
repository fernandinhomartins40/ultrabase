#!/bin/bash

# Comandos diretos para corrigir erro 502
VPS_HOST="82.25.69.57"
VPS_USER="root"

echo "🚀 Correção direta do erro 502 Bad Gateway"
echo "=========================================="

# Função para executar comando SSH
run_ssh() {
    echo "💻 Executando: $1"
    ssh -o StrictHostKeyChecking=no $VPS_USER@$VPS_HOST "$1"
    echo "✅ Concluído"
    echo ""
}

echo "📡 Conectando ao servidor..."

# 1. Verificar status atual
echo "1️⃣ Verificando status atual..."
run_ssh "docker ps --format 'table {{.Names}}\t{{.Status}}'"

# 2. Parar containers
echo "2️⃣ Parando containers..."
run_ssh "cd /opt/supabase-manager/src/docker && docker compose -f docker-compose.production.yml down"

# 3. Atualizar código
echo "3️⃣ Atualizando código..."
run_ssh "cd /opt/supabase-manager && git pull"

# 4. Reinstalar dependências
echo "4️⃣ Instalando dependências..."
run_ssh "cd /opt/supabase-manager/src && npm install --production"

# 5. Reiniciar containers
echo "5️⃣ Reiniciando containers..."
run_ssh "cd /opt/supabase-manager/src/docker && docker compose -f docker-compose.production.yml up -d"

# 6. Aguardar e verificar
echo "6️⃣ Aguardando containers ficarem prontos..."
sleep 20

run_ssh "docker ps --format 'table {{.Names}}\t{{.Status}}'"

# 7. Testar aplicação
echo "7️⃣ Testando aplicação..."
run_ssh "curl -s -o /dev/null -w '%{http_code}' http://localhost:80 || echo 'ERRO'"

echo "✅ Processo concluído!"
echo "🌐 Teste: http://$VPS_HOST" 