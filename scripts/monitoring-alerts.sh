#!/bin/bash

# 📊 ULTRABASE MONITORING & ALERTS SYSTEM
# Sistema de monitoramento contínuo e alertas para o Ultrabase
# 
# Funcionalidades:
# - Monitoramento de saúde da aplicação
# - Verificação de recursos do sistema
# - Alertas por Discord/Webhook
# - Logs estruturados
# - Auto-recovery básico

set -euo pipefail

# ============================================================================
# CONFIGURAÇÕES
# ============================================================================

readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly DEPLOY_DIR="/opt/supabase-manager"
readonly MONITOR_LOG_DIR="/var/log/ultrabase-monitor"
readonly CONFIG_FILE="$DEPLOY_DIR/monitor-config.json"
readonly STATE_FILE="/tmp/ultrabase-monitor-state.json"
readonly VPS_HOST="${VPS_HOST:-82.25.69.57}"
readonly VPS_USER="${VPS_USER:-root}"

# Configurações padrão
readonly DEFAULT_CHECK_INTERVAL=60  # segundos
readonly DEFAULT_ALERT_COOLDOWN=300 # 5 minutos
readonly DEFAULT_MAX_RETRIES=3

# Cores para output
readonly GREEN='\033[0;32m'
readonly YELLOW='\033[1;33m'
readonly RED='\033[0;31m'
readonly BLUE='\033[0;34m'
readonly NC='\033[0m'

# ============================================================================
# FUNÇÕES UTILITÁRIAS
# ============================================================================

log() {
    local level=${2:-INFO}
    local message="$1"
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    echo -e "${GREEN}[$timestamp] [$level] $message${NC}"
    
    # Log estruturado para arquivo
    if [[ -w "$MONITOR_LOG_DIR" ]] || mkdir -p "$MONITOR_LOG_DIR" 2>/dev/null; then
        echo "{\"timestamp\":\"$timestamp\",\"level\":\"$level\",\"message\":\"$message\"}" >> "$MONITOR_LOG_DIR/monitor.log"
    fi
}

warn() {
    log "$1" "WARN"
    echo -e "${YELLOW}[WARNING] $1${NC}" >&2
}

error() {
    log "$1" "ERROR"
    echo -e "${RED}[ERROR] $1${NC}" >&2
}

info() {
    log "$1" "INFO"
    echo -e "${BLUE}[INFO] $1${NC}"
}

# ============================================================================
# FUNÇÕES DE CONFIGURAÇÃO
# ============================================================================

create_default_config() {
    log "📝 Criando configuração padrão do monitor..."
    
    ssh $VPS_USER@$VPS_HOST "
        mkdir -p \$(dirname $CONFIG_FILE)
        cat > $CONFIG_FILE << 'EOF'
{
    \"monitoring\": {
        \"enabled\": true,
        \"check_interval\": $DEFAULT_CHECK_INTERVAL,
        \"alert_cooldown\": $DEFAULT_ALERT_COOLDOWN,
        \"max_retries\": $DEFAULT_MAX_RETRIES
    },
    \"checks\": {
        \"application_health\": {
            \"enabled\": true,
            \"endpoint\": \"http://localhost:3080/api/health\",
            \"timeout\": 10
        },
        \"pm2_status\": {
            \"enabled\": true,
            \"process_name\": \"supabase-manager\"
        },
        \"docker_status\": {
            \"enabled\": true,
            \"min_containers\": 0
        },
        \"disk_usage\": {
            \"enabled\": true,
            \"warning_threshold\": 80,
            \"critical_threshold\": 90
        },
        \"memory_usage\": {
            \"enabled\": true,
            \"warning_threshold\": 85,
            \"critical_threshold\": 95
        },
        \"cpu_usage\": {
            \"enabled\": true,
            \"warning_threshold\": 80,
            \"critical_threshold\": 90
        },
        \"instances_health\": {
            \"enabled\": true,
            \"check_individual_instances\": true
        }
    },
    \"alerts\": {
        \"discord\": {
            \"enabled\": false,
            \"webhook_url\": \"\",
            \"username\": \"Ultrabase Monitor\",
            \"avatar_url\": \"\"
        },
        \"webhook\": {
            \"enabled\": false,
            \"url\": \"\",
            \"headers\": {}
        },
        \"email\": {
            \"enabled\": false,
            \"smtp_server\": \"\",
            \"smtp_port\": 587,
            \"username\": \"\",
            \"password\": \"\",
            \"from\": \"\",
            \"to\": []
        }
    },
    \"auto_recovery\": {
        \"enabled\": true,
        \"restart_pm2_on_failure\": true,
        \"restart_docker_on_failure\": false,
        \"max_recovery_attempts\": 3
    }
}
EOF
        log '✅ Configuração criada: $CONFIG_FILE'
    "
}

# ============================================================================
# FUNÇÕES DE VERIFICAÇÃO
# ============================================================================

check_application_health() {
    local endpoint=$(ssh $VPS_USER@$VPS_HOST "cat $CONFIG_FILE | jq -r '.checks.application_health.endpoint' 2>/dev/null" || echo "http://localhost:3080/api/health")
    local timeout=$(ssh $VPS_USER@$VPS_HOST "cat $CONFIG_FILE | jq -r '.checks.application_health.timeout' 2>/dev/null" || echo "10")
    
    if ssh $VPS_USER@$VPS_HOST "curl -f -m $timeout $endpoint >/dev/null 2>&1"; then
        return 0
    else
        return 1
    fi
}

check_pm2_status() {
    local process_name=$(ssh $VPS_USER@$VPS_HOST "cat $CONFIG_FILE | jq -r '.checks.pm2_status.process_name' 2>/dev/null" || echo "supabase-manager")
    
    if ssh $VPS_USER@$VPS_HOST "pm2 list --no-colors | grep -q '$process_name.*online'"; then
        return 0
    else
        return 1
    fi
}

check_docker_status() {
    local min_containers=$(ssh $VPS_USER@$VPS_HOST "cat $CONFIG_FILE | jq -r '.checks.docker_status.min_containers' 2>/dev/null" || echo "0")
    local container_count=$(ssh $VPS_USER@$VPS_HOST "docker ps -q | wc -l" 2>/dev/null || echo "0")
    
    if [ "$container_count" -ge "$min_containers" ]; then
        return 0
    else
        return 1
    fi
}

check_disk_usage() {
    local warning_threshold=$(ssh $VPS_USER@$VPS_HOST "cat $CONFIG_FILE | jq -r '.checks.disk_usage.warning_threshold' 2>/dev/null" || echo "80")
    local critical_threshold=$(ssh $VPS_USER@$VPS_HOST "cat $CONFIG_FILE | jq -r '.checks.disk_usage.critical_threshold' 2>/dev/null" || echo "90")
    
    local usage=$(ssh $VPS_USER@$VPS_HOST "df / | tail -1 | awk '{print \$5}' | sed 's/%//'" 2>/dev/null || echo "0")
    
    if [ "$usage" -ge "$critical_threshold" ]; then
        return 2  # Critical
    elif [ "$usage" -ge "$warning_threshold" ]; then
        return 1  # Warning
    else
        return 0  # OK
    fi
}

check_memory_usage() {
    local warning_threshold=$(ssh $VPS_USER@$VPS_HOST "cat $CONFIG_FILE | jq -r '.checks.memory_usage.warning_threshold' 2>/dev/null" || echo "85")
    local critical_threshold=$(ssh $VPS_USER@$VPS_HOST "cat $CONFIG_FILE | jq -r '.checks.memory_usage.critical_threshold' 2>/dev/null" || echo "95")
    
    local usage=$(ssh $VPS_USER@$VPS_HOST "free | grep Mem | awk '{printf \"%.0f\", \$3/\$2 * 100}'" 2>/dev/null || echo "0")
    
    if [ "$usage" -ge "$critical_threshold" ]; then
        return 2  # Critical
    elif [ "$usage" -ge "$warning_threshold" ]; then
        return 1  # Warning
    else
        return 0  # OK
    fi
}

check_cpu_usage() {
    local warning_threshold=$(ssh $VPS_USER@$VPS_HOST "cat $CONFIG_FILE | jq -r '.checks.cpu_usage.warning_threshold' 2>/dev/null" || echo "80")
    local critical_threshold=$(ssh $VPS_USER@$VPS_HOST "cat $CONFIG_FILE | jq -r '.checks.cpu_usage.critical_threshold' 2>/dev/null" || echo "90")
    
    local usage=$(ssh $VPS_USER@$VPS_HOST "top -bn1 | grep 'Cpu(s)' | awk '{print \$2}' | sed 's/%us,//'" 2>/dev/null || echo "0")
    usage=${usage%.*}  # Remove decimal part
    
    if [ "$usage" -ge "$critical_threshold" ]; then
        return 2  # Critical
    elif [ "$usage" -ge "$warning_threshold" ]; then
        return 1  # Warning
    else
        return 0  # OK
    fi
}

check_instances_health() {
    local instances_file="$DEPLOY_DIR/src/instances.json"
    
    if ! ssh $VPS_USER@$VPS_HOST "[ -f $instances_file ]"; then
        return 0  # No instances to check
    fi
    
    local failed_instances=0
    local total_instances=0
    
    ssh $VPS_USER@$VPS_HOST "
        if [ -f $instances_file ] && [ -s $instances_file ]; then
            cat $instances_file | jq -r 'to_entries[] | .key + \",\" + .value.name + \",\" + (.value.kong_http_port | tostring) + \",\" + .value.status' 2>/dev/null | while IFS=',' read -r id name port status; do
                total_instances=\$((total_instances + 1))
                
                if [ \"\$status\" = \"running\" ]; then
                    if ! curl -f -m 5 http://localhost:\$port >/dev/null 2>&1; then
                        failed_instances=\$((failed_instances + 1))
                        echo \"FAILED_INSTANCE:\$name:\$port\" >&2
                    fi
                fi
            done
            
            echo \"TOTAL:\$total_instances\"
            echo \"FAILED:\$failed_instances\"
        fi
    " 2>/tmp/instance_check_errors.log | {
        total=0
        failed=0
        
        while read -r line; do
            if [[ "$line" =~ ^TOTAL:([0-9]+)$ ]]; then
                total="${BASH_REMATCH[1]}"
            elif [[ "$line" =~ ^FAILED:([0-9]+)$ ]]; then
                failed="${BASH_REMATCH[1]}"
            fi
        done
        
        if [ "$failed" -gt 0 ]; then
            return 1
        else
            return 0
        fi
    }
}

# ============================================================================
# FUNÇÕES DE ALERTAS
# ============================================================================

send_discord_alert() {
    local level="$1"
    local message="$2"
    local details="$3"
    
    local webhook_url=$(ssh $VPS_USER@$VPS_HOST "cat $CONFIG_FILE | jq -r '.alerts.discord.webhook_url' 2>/dev/null" || echo "")
    
    if [ -z "$webhook_url" ] || [ "$webhook_url" = "null" ]; then
        return 1
    fi
    
    local color="3447003"  # Blue
    case $level in
        "WARNING") color="16776960" ;; # Yellow
        "CRITICAL") color="16711680" ;; # Red
    esac
    
    local payload=$(cat << EOF
{
    "username": "Ultrabase Monitor",
    "embeds": [{
        "title": "🚨 Alerta do Sistema - $level",
        "description": "$message",
        "color": $color,
        "fields": [
            {
                "name": "Detalhes",
                "value": "$details",
                "inline": false
            },
            {
                "name": "Servidor",
                "value": "$VPS_HOST",
                "inline": true
            },
            {
                "name": "Timestamp",
                "value": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
                "inline": true
            }
        ]
    }]
}
EOF
)
    
    curl -H "Content-Type: application/json" -d "$payload" "$webhook_url" >/dev/null 2>&1 || true
}

send_webhook_alert() {
    local level="$1"
    local message="$2"
    local details="$3"
    
    local webhook_url=$(ssh $VPS_USER@$VPS_HOST "cat $CONFIG_FILE | jq -r '.alerts.webhook.url' 2>/dev/null" || echo "")
    
    if [ -z "$webhook_url" ] || [ "$webhook_url" = "null" ]; then
        return 1
    fi
    
    local payload=$(cat << EOF
{
    "level": "$level",
    "message": "$message",
    "details": "$details",
    "server": "$VPS_HOST",
    "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
    "source": "ultrabase-monitor"
}
EOF
)
    
    curl -H "Content-Type: application/json" -d "$payload" "$webhook_url" >/dev/null 2>&1 || true
}

send_alert() {
    local level="$1"
    local message="$2"
    local details="$3"
    
    log "📢 Enviando alerta: $level - $message" "ALERT"
    
    # Discord
    if ssh $VPS_USER@$VPS_HOST "cat $CONFIG_FILE | jq -r '.alerts.discord.enabled' 2>/dev/null" | grep -q "true"; then
        send_discord_alert "$level" "$message" "$details"
    fi
    
    # Webhook genérico
    if ssh $VPS_USER@$VPS_HOST "cat $CONFIG_FILE | jq -r '.alerts.webhook.enabled' 2>/dev/null" | grep -q "true"; then
        send_webhook_alert "$level" "$message" "$details"
    fi
}

# ============================================================================
# FUNÇÕES DE AUTO-RECOVERY
# ============================================================================

attempt_auto_recovery() {
    local service="$1"
    local issue="$2"
    
    if ! ssh $VPS_USER@$VPS_HOST "cat $CONFIG_FILE | jq -r '.auto_recovery.enabled' 2>/dev/null" | grep -q "true"; then
        return 1
    fi
    
    log "🔧 Tentando auto-recovery para: $service ($issue)"
    
    case $service in
        "pm2")
            if ssh $VPS_USER@$VPS_HOST "cat $CONFIG_FILE | jq -r '.auto_recovery.restart_pm2_on_failure' 2>/dev/null" | grep -q "true"; then
                ssh $VPS_USER@$VPS_HOST "pm2 restart supabase-manager"
                sleep 10
                if check_pm2_status && check_application_health; then
                    log "✅ Auto-recovery PM2 bem-sucedido"
                    send_alert "INFO" "Auto-recovery bem-sucedido" "PM2 foi reiniciado e aplicação está funcionando"
                    return 0
                fi
            fi
            ;;
        "docker")
            if ssh $VPS_USER@$VPS_HOST "cat $CONFIG_FILE | jq -r '.auto_recovery.restart_docker_on_failure' 2>/dev/null" | grep -q "true"; then
                ssh $VPS_USER@$VPS_HOST "systemctl restart docker"
                sleep 15
                if check_docker_status; then
                    log "✅ Auto-recovery Docker bem-sucedido"
                    send_alert "INFO" "Auto-recovery bem-sucedido" "Docker foi reiniciado"
                    return 0
                fi
            fi
            ;;
    esac
    
    return 1
}

# ============================================================================
# FUNÇÃO PRINCIPAL DE MONITORAMENTO
# ============================================================================

run_monitoring_cycle() {
    log "🔍 Iniciando ciclo de monitoramento..."
    
    local issues_found=0
    local critical_issues=0
    local alerts_sent=0
    
    # Verificar se configuração existe
    if ! ssh $VPS_USER@$VPS_HOST "[ -f $CONFIG_FILE ]"; then
        warn "Configuração não encontrada, criando padrão..."
        create_default_config
    fi
    
    # Health check da aplicação
    if ssh $VPS_USER@$VPS_HOST "cat $CONFIG_FILE | jq -r '.checks.application_health.enabled' 2>/dev/null" | grep -q "true"; then
        if ! check_application_health; then
            issues_found=$((issues_found + 1))
            critical_issues=$((critical_issues + 1))
            
            # Tentar auto-recovery
            if ! attempt_auto_recovery "pm2" "application_health_failed"; then
                send_alert "CRITICAL" "Aplicação não está respondendo" "Health check falhou em http://localhost:3080/api/health"
                alerts_sent=$((alerts_sent + 1))
            fi
        else
            log "✅ Health check da aplicação: OK"
        fi
    fi
    
    # Status do PM2
    if ssh $VPS_USER@$VPS_HOST "cat $CONFIG_FILE | jq -r '.checks.pm2_status.enabled' 2>/dev/null" | grep -q "true"; then
        if ! check_pm2_status; then
            issues_found=$((issues_found + 1))
            critical_issues=$((critical_issues + 1))
            
            if ! attempt_auto_recovery "pm2" "pm2_process_down"; then
                send_alert "CRITICAL" "Processo PM2 não está rodando" "supabase-manager não encontrado no PM2"
                alerts_sent=$((alerts_sent + 1))
            fi
        else
            log "✅ Status do PM2: OK"
        fi
    fi
    
    # Status do Docker
    if ssh $VPS_USER@$VPS_HOST "cat $CONFIG_FILE | jq -r '.checks.docker_status.enabled' 2>/dev/null" | grep -q "true"; then
        if ! check_docker_status; then
            issues_found=$((issues_found + 1))
            send_alert "WARNING" "Docker com poucos containers" "Verificar se instâncias estão rodando corretamente"
            alerts_sent=$((alerts_sent + 1))
        else
            log "✅ Status do Docker: OK"
        fi
    fi
    
    # Uso do disco
    if ssh $VPS_USER@$VPS_HOST "cat $CONFIG_FILE | jq -r '.checks.disk_usage.enabled' 2>/dev/null" | grep -q "true"; then
        check_disk_usage
        local disk_status=$?
        
        case $disk_status in
            2)
                issues_found=$((issues_found + 1))
                critical_issues=$((critical_issues + 1))
                local usage=$(ssh $VPS_USER@$VPS_HOST "df / | tail -1 | awk '{print \$5}'")
                send_alert "CRITICAL" "Uso crítico de disco" "Uso atual: $usage"
                alerts_sent=$((alerts_sent + 1))
                ;;
            1)
                issues_found=$((issues_found + 1))
                local usage=$(ssh $VPS_USER@$VPS_HOST "df / | tail -1 | awk '{print \$5}'")
                send_alert "WARNING" "Alto uso de disco" "Uso atual: $usage"
                alerts_sent=$((alerts_sent + 1))
                ;;
            0)
                log "✅ Uso do disco: OK"
                ;;
        esac
    fi
    
    # Uso da memória
    if ssh $VPS_USER@$VPS_HOST "cat $CONFIG_FILE | jq -r '.checks.memory_usage.enabled' 2>/dev/null" | grep -q "true"; then
        check_memory_usage
        local memory_status=$?
        
        case $memory_status in
            2)
                issues_found=$((issues_found + 1))
                critical_issues=$((critical_issues + 1))
                local usage=$(ssh $VPS_USER@$VPS_HOST "free | grep Mem | awk '{printf \"%.1f%%\", \$3/\$2 * 100}'")
                send_alert "CRITICAL" "Uso crítico de memória" "Uso atual: $usage"
                alerts_sent=$((alerts_sent + 1))
                ;;
            1)
                issues_found=$((issues_found + 1))
                local usage=$(ssh $VPS_USER@$VPS_HOST "free | grep Mem | awk '{printf \"%.1f%%\", \$3/\$2 * 100}'")
                send_alert "WARNING" "Alto uso de memória" "Uso atual: $usage"
                alerts_sent=$((alerts_sent + 1))
                ;;
            0)
                log "✅ Uso da memória: OK"
                ;;
        esac
    fi
    
    # Saúde das instâncias
    if ssh $VPS_USER@$VPS_HOST "cat $CONFIG_FILE | jq -r '.checks.instances_health.enabled' 2>/dev/null" | grep -q "true"; then
        if ! check_instances_health; then
            issues_found=$((issues_found + 1))
            send_alert "WARNING" "Problemas em instâncias Supabase" "Uma ou mais instâncias não estão respondendo"
            alerts_sent=$((alerts_sent + 1))
        else
            log "✅ Saúde das instâncias: OK"
        fi
    fi
    
    # Resumo do ciclo
    log "📊 Ciclo concluído: $issues_found problemas encontrados ($critical_issues críticos), $alerts_sent alertas enviados"
    
    # Atualizar estado
    ssh $VPS_USER@$VPS_HOST "
        cat > $STATE_FILE << EOF
{
    \"last_check\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",
    \"issues_found\": $issues_found,
    \"critical_issues\": $critical_issues,
    \"alerts_sent\": $alerts_sent,
    \"status\": \"$([ $critical_issues -eq 0 ] && echo 'healthy' || echo 'unhealthy')\"
}
EOF
    "
}

# ============================================================================
# FUNÇÃO PRINCIPAL
# ============================================================================

main() {
    local command=${1:-monitor}
    
    case $command in
        "init")
            log "🚀 Inicializando sistema de monitoramento..."
            create_default_config
            ssh $VPS_USER@$VPS_HOST "mkdir -p $MONITOR_LOG_DIR"
            log "✅ Sistema inicializado!"
            echo ""
            echo "📝 Próximos passos:"
            echo "1. Edite $CONFIG_FILE para configurar alertas"
            echo "2. Execute: $0 monitor (para teste)"
            echo "3. Configure cron: $0 install-cron"
            ;;
        "config")
            ssh $VPS_USER@$VPS_HOST "cat $CONFIG_FILE 2>/dev/null || echo 'Configuração não encontrada. Execute: $0 init'"
            ;;
        "edit-config")
            ssh $VPS_USER@$VPS_HOST "nano $CONFIG_FILE"
            ;;
        "monitor")
            run_monitoring_cycle
            ;;
        "test-alerts")
            log "🧪 Testando sistema de alertas..."
            send_alert "INFO" "Teste do sistema de alertas" "Este é um teste para verificar se os alertas estão funcionando"
            log "✅ Teste de alertas enviado"
            ;;
        "status")
            ssh $VPS_USER@$VPS_HOST "
                echo '📊 STATUS DO SISTEMA DE MONITORAMENTO'
                echo '====================================='
                if [ -f $STATE_FILE ]; then
                    cat $STATE_FILE | jq -r '
                        \"Última verificação: \" + .last_check,
                        \"Status: \" + .status,
                        \"Problemas encontrados: \" + (.issues_found | tostring),
                        \"Problemas críticos: \" + (.critical_issues | tostring),
                        \"Alertas enviados: \" + (.alerts_sent | tostring)
                    '
                else
                    echo 'Nenhuma verificação executada ainda'
                fi
                
                echo ''
                echo 'Configuração:'
                if [ -f $CONFIG_FILE ]; then
                    echo 'Monitoramento habilitado: ' \$(cat $CONFIG_FILE | jq -r '.monitoring.enabled')
                    echo 'Intervalo de verificação: ' \$(cat $CONFIG_FILE | jq -r '.monitoring.check_interval') 'segundos'
                    echo 'Auto-recovery habilitado: ' \$(cat $CONFIG_FILE | jq -r '.auto_recovery.enabled')
                else
                    echo 'Configuração não encontrada'
                fi
            "
            ;;
        "install-cron")
            local interval=${2:-60}
            log "⏰ Instalando monitoramento no cron (intervalo: ${interval}s)..."
            ssh $VPS_USER@$VPS_HOST "
                # Criar script wrapper
                cat > /usr/local/bin/ultrabase-monitor.sh << 'EOF'
#!/bin/bash
cd $(dirname $0)
$(realpath $0) monitor
EOF
                chmod +x /usr/local/bin/ultrabase-monitor.sh
                
                # Adicionar ao cron
                (crontab -l 2>/dev/null || true; echo \"*/$((interval/60)) * * * * /usr/local/bin/ultrabase-monitor.sh\") | crontab -
            "
            log "✅ Monitoramento instalado no cron"
            ;;
        "remove-cron")
            log "🗑️ Removendo monitoramento do cron..."
            ssh $VPS_USER@$VPS_HOST "
                crontab -l 2>/dev/null | grep -v ultrabase-monitor.sh | crontab - || true
                rm -f /usr/local/bin/ultrabase-monitor.sh
            "
            log "✅ Monitoramento removido do cron"
            ;;
        "logs")
            local lines=${2:-50}
            ssh $VPS_USER@$VPS_HOST "
                if [ -f $MONITOR_LOG_DIR/monitor.log ]; then
                    tail -n $lines $MONITOR_LOG_DIR/monitor.log | jq -r '.timestamp + \" [\" + .level + \"] \" + .message'
                else
                    echo 'Nenhum log encontrado'
                fi
            "
            ;;
        *)
            echo "Sistema de Monitoramento do Ultrabase"
            echo "===================================="
            echo ""
            echo "Uso: $0 {comando} [opções]"
            echo ""
            echo "Comandos disponíveis:"
            echo "  init                    - Inicializar sistema de monitoramento"
            echo "  config                  - Mostrar configuração atual"
            echo "  edit-config             - Editar configuração"
            echo "  monitor                 - Executar ciclo de monitoramento"
            echo "  test-alerts             - Testar sistema de alertas"
            echo "  status                  - Status do sistema de monitoramento"
            echo "  install-cron [intervalo] - Instalar no cron (padrão: 60s)"
            echo "  remove-cron             - Remover do cron"
            echo "  logs [linhas]           - Ver logs (padrão: 50 linhas)"
            echo ""
            echo "Exemplos:"
            echo "  $0 init"
            echo "  $0 monitor"
            echo "  $0 install-cron 300  # Verificar a cada 5 minutos"
            exit 1
            ;;
    esac
}

# Executar função principal
main "$@" 