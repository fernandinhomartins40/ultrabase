#!/bin/bash

# Script para debug remoto dos containers Docker
# Uso: ./debug_containers.sh

echo "🔍 SUPABASE INSTANCE MANAGER - DEBUG DOS CONTAINERS"
echo "=================================================="

# Definir variáveis SSH (você pode ajustar conforme necessário)
VPS_HOST="${VPS_HOST:-82.25.69.57}"
VPS_USER="${VPS_USER:-root}"
SSH_KEY="${SSH_KEY:-~/.ssh/ultrabase_key}"

echo "🌐 Conectando ao servidor: $VPS_USER@$VPS_HOST"
echo ""

# Verificar se a chave SSH existe
if [ ! -f "$SSH_KEY" ]; then
    echo "❌ Chave SSH não encontrada: $SSH_KEY"
    echo "💡 Certifique-se de que a chave SSH está no local correto"
    exit 1
fi

# Função para executar comandos remotos
run_remote() {
    local cmd="$1"
    local description="$2"
    
    echo "📋 $description"
    echo "💻 Executando: $cmd"
    echo "----------------------------------------"
    
    ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no "$VPS_USER@$VPS_HOST" "$cmd"
    local exit_code=$?
    
    echo ""
    if [ $exit_code -eq 0 ]; then
        echo "✅ Comando executado com sucesso"
    else
        echo "❌ Comando falhou (código: $exit_code)"
    fi
    echo ""
    echo "========================================"
    echo ""
}

# 1. Verificar status geral do Docker
run_remote "docker --version && docker compose version" "Verificando versões do Docker"

# 2. Listar todos os containers
run_remote "docker ps -a" "Listando todos os containers"

# 3. Verificar containers do projeto
run_remote "docker ps -a | grep -E '(supabase-instance-manager|supabase-manager-nginx)'" "Containers do Instance Manager"

# 4. Verificar logs do nginx
run_remote "docker logs --tail=50 supabase-manager-nginx 2>&1 || echo 'Container nginx não encontrado'" "Logs do Nginx (últimas 50 linhas)"

# 5. Verificar logs da aplicação
run_remote "docker logs --tail=50 supabase-instance-manager 2>&1 || echo 'Container manager não encontrado'" "Logs da Aplicação (últimas 50 linhas)"

# 6. Verificar se as portas estão sendo usadas
run_remote "netstat -tlnp | grep -E ':(80|443|3080)'" "Verificando portas em uso"

# 7. Verificar se os serviços estão respondendo internamente
run_remote "curl -s -o /dev/null -w '%{http_code}' http://localhost:80 2>/dev/null || echo 'Não responde'" "Testando Nginx (porta 80)"
run_remote "curl -s -o /dev/null -w '%{http_code}' http://localhost:3080/api/health 2>/dev/null || echo 'Não responde'" "Testando Aplicação (porta 3080)"

# 8. Verificar recursos do sistema
run_remote "df -h && echo '---' && free -h && echo '---' && uptime" "Recursos do sistema"

# 9. Verificar logs do sistema
run_remote "journalctl -u docker --no-pager --lines=10" "Logs recentes do Docker (systemd)"

# 10. Verificar configurações de rede do Docker
run_remote "docker network ls && echo '---' && docker network inspect supabase-manager-network 2>/dev/null || echo 'Rede não encontrada'" "Configurações de rede"

echo "🎯 COMANDOS ÚTEIS PARA DEBUG MANUAL:"
echo "=================================="
echo ""
echo "1. Conectar ao servidor:"
echo "   ssh -i $SSH_KEY $VPS_USER@$VPS_HOST"
echo ""
echo "2. Verificar logs em tempo real:"
echo "   docker logs -f supabase-manager-nginx"
echo "   docker logs -f supabase-instance-manager"
echo ""
echo "3. Reiniciar serviços:"
echo "   cd /app/ultrabase/src/docker"
echo "   docker compose -f docker-compose.production.yml down"
echo "   docker compose -f docker-compose.production.yml up -d"
echo ""
echo "4. Verificar configuração nginx:"
echo "   docker exec supabase-manager-nginx nginx -t"
echo ""
echo "5. Verificar conectividade interna:"
echo "   docker exec supabase-manager-nginx curl http://manager:3080/api/health"
echo ""

echo "✅ Debug concluído!" 