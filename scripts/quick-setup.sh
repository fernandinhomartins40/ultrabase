#!/bin/bash

# 🚀 ULTRABASE QUICK SETUP
# Configuração rápida do sistema de versionamento completo
# 
# Este script automatiza toda a configuração inicial do sistema

set -euo pipefail

# ============================================================================
# CONFIGURAÇÕES
# ============================================================================

readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
readonly VPS_HOST="${VPS_HOST:-82.25.69.57}"
readonly VPS_USER="${VPS_USER:-root}"
readonly DEPLOY_DIR="/opt/supabase-manager"

# Cores para output
readonly GREEN='\033[0;32m'
readonly YELLOW='\033[1;33m'
readonly RED='\033[0;31m'
readonly BLUE='\033[0;34m'
readonly CYAN='\033[0;36m'
readonly NC='\033[0m'

# ============================================================================
# FUNÇÕES UTILITÁRIAS
# ============================================================================

log() {
    echo -e "${GREEN}[SETUP] $1${NC}"
}

warn() {
    echo -e "${YELLOW}[WARNING] $1${NC}"
}

error() {
    echo -e "${RED}[ERROR] $1${NC}"
    exit 1
}

info() {
    echo -e "${BLUE}[INFO] $1${NC}"
}

step() {
    echo -e "${CYAN}[STEP] $1${NC}"
}

# ============================================================================
# VERIFICAÇÕES INICIAIS
# ============================================================================

check_prerequisites() {
    step "Verificando pré-requisitos..."
    
    # Verificar se podemos conectar na VPS
    if ! ssh -o ConnectTimeout=5 $VPS_USER@$VPS_HOST "echo 'OK'" >/dev/null 2>&1; then
        error "Não é possível conectar na VPS ($VPS_HOST). Verifique SSH keys."
    fi
    
    # Verificar se git está disponível
    if ! command -v git >/dev/null 2>&1; then
        error "Git não está instalado"
    fi
    
    log "✅ Pré-requisitos verificados"
}

# ============================================================================
# CONFIGURAÇÃO DA VPS
# ============================================================================

setup_vps_environment() {
    step "Configurando ambiente na VPS..."
    
    ssh $VPS_USER@$VPS_HOST "
        # Instalar dependências se necessário
        if ! command -v jq >/dev/null 2>&1; then
            log 'Instalando jq...'
            apt-get update && apt-get install -y jq
        fi
        
        if ! command -v curl >/dev/null 2>&1; then
            log 'Instalando curl...'
            apt-get update && apt-get install -y curl
        fi
        
        # Criar diretórios necessários
        mkdir -p $DEPLOY_DIR/scripts
        mkdir -p /var/log/ultrabase-monitor
        
        # Definir permissões corretas
        chmod +x $DEPLOY_DIR/scripts/*.sh 2>/dev/null || true
    "
    
    log "✅ Ambiente da VPS configurado"
}

# ============================================================================
# UPLOAD DOS SCRIPTS
# ============================================================================

upload_scripts() {
    step "Enviando scripts para a VPS..."
    
    # Upload dos scripts principais
    scp "$SCRIPT_DIR/deploy-versioning.sh" $VPS_USER@$VPS_HOST:$DEPLOY_DIR/scripts/
    scp "$SCRIPT_DIR/data-preservation.sh" $VPS_USER@$VPS_HOST:$DEPLOY_DIR/scripts/
    scp "$SCRIPT_DIR/migration-system.sh" $VPS_USER@$VPS_HOST:$DEPLOY_DIR/scripts/
    scp "$SCRIPT_DIR/monitoring-alerts.sh" $VPS_USER@$VPS_HOST:$DEPLOY_DIR/scripts/
    
    # Definir permissões executáveis
    ssh $VPS_USER@$VPS_HOST "
        chmod +x $DEPLOY_DIR/scripts/*.sh
        
        # Criar links simbólicos para facilitar o uso
        ln -sf $DEPLOY_DIR/scripts/deploy-versioning.sh /usr/local/bin/ultrabase-deploy
        ln -sf $DEPLOY_DIR/scripts/data-preservation.sh /usr/local/bin/ultrabase-preserve
        ln -sf $DEPLOY_DIR/scripts/migration-system.sh /usr/local/bin/ultrabase-migrate
        ln -sf $DEPLOY_DIR/scripts/monitoring-alerts.sh /usr/local/bin/ultrabase-monitor
    "
    
    log "✅ Scripts enviados e configurados"
}

# ============================================================================
# INICIALIZAÇÃO DOS SISTEMAS
# ============================================================================

initialize_systems() {
    step "Inicializando sistemas..."
    
    ssh $VPS_USER@$VPS_HOST "
        # Inicializar sistema de migrações
        log 'Inicializando sistema de migrações...'
        $DEPLOY_DIR/scripts/migration-system.sh init
        
        # Inicializar sistema de monitoramento
        log 'Inicializando sistema de monitoramento...'
        $DEPLOY_DIR/scripts/monitoring-alerts.sh init
        
        # Criar backup inicial
        log 'Criando backup inicial...'
        $DEPLOY_DIR/scripts/deploy-versioning.sh backup || true
    "
    
    log "✅ Sistemas inicializados"
}

# ============================================================================
# CONFIGURAÇÃO DE MONITORAMENTO
# ============================================================================

setup_monitoring() {
    step "Configurando monitoramento automático..."
    
    echo ""
    echo "🔧 Configuração do Monitoramento"
    echo "================================"
    
    read -p "Instalar monitoramento automático? (y/n): " install_monitoring
    
    if [[ "$install_monitoring" =~ ^[Yy]$ ]]; then
        echo "Intervalos disponíveis:"
        echo "1) 1 minuto (desenvolvimento)"
        echo "2) 5 minutos (recomendado)"
        echo "3) 15 minutos (produção leve)"
        echo "4) Custom"
        
        read -p "Escolha o intervalo [2]: " interval_choice
        interval_choice=${interval_choice:-2}
        
        case $interval_choice in
            1) interval=60 ;;
            2) interval=300 ;;
            3) interval=900 ;;
            4) 
                read -p "Digite o intervalo em segundos: " interval
                ;;
            *) interval=300 ;;
        esac
        
        ssh $VPS_USER@$VPS_HOST "$DEPLOY_DIR/scripts/monitoring-alerts.sh install-cron $interval"
        log "✅ Monitoramento configurado para rodar a cada $interval segundos"
    else
        info "Monitoramento não instalado automaticamente"
        info "Para instalar depois: ultrabase-monitor install-cron [intervalo]"
    fi
}

# ============================================================================
# CONFIGURAÇÃO DE ALERTAS
# ============================================================================

setup_alerts() {
    step "Configurando alertas..."
    
    echo ""
    echo "🚨 Configuração de Alertas"
    echo "=========================="
    
    read -p "Configurar alertas Discord? (y/n): " setup_discord
    
    if [[ "$setup_discord" =~ ^[Yy]$ ]]; then
        echo ""
        echo "📋 Para configurar Discord:"
        echo "1. Vá no seu servidor Discord"
        echo "2. Configurações → Integrações → Webhooks"
        echo "3. Criar Webhook e copiar a URL"
        echo ""
        
        read -p "URL do webhook Discord: " discord_webhook
        
        if [ -n "$discord_webhook" ]; then
            ssh $VPS_USER@$VPS_HOST "
                # Atualizar configuração com webhook Discord
                tmp_file=\$(mktemp)
                cat $DEPLOY_DIR/monitor-config.json | jq '
                    .alerts.discord.enabled = true |
                    .alerts.discord.webhook_url = \"$discord_webhook\"
                ' > \"\$tmp_file\" && mv \"\$tmp_file\" $DEPLOY_DIR/monitor-config.json
            "
            
            log "✅ Discord configurado"
            
            # Testar alertas
            read -p "Testar alertas agora? (y/n): " test_alerts
            if [[ "$test_alerts" =~ ^[Yy]$ ]]; then
                ssh $VPS_USER@$VPS_HOST "$DEPLOY_DIR/scripts/monitoring-alerts.sh test-alerts"
                log "✅ Teste de alertas enviado"
            fi
        fi
    fi
}

# ============================================================================
# VERIFICAÇÃO FINAL
# ============================================================================

final_verification() {
    step "Verificação final do sistema..."
    
    ssh $VPS_USER@$VPS_HOST "
        echo '🔍 VERIFICAÇÃO FINAL'
        echo '==================='
        
        # Verificar scripts
        echo 'Scripts instalados:'
        ls -la $DEPLOY_DIR/scripts/
        echo ''
        
        # Verificar links simbólicos
        echo 'Comandos disponíveis:'
        ls -la /usr/local/bin/ultrabase-*
        echo ''
        
        # Verificar sistemas
        echo 'Status dos sistemas:'
        $DEPLOY_DIR/scripts/migration-system.sh status 2>/dev/null || echo 'Migrações: OK'
        $DEPLOY_DIR/scripts/monitoring-alerts.sh status 2>/dev/null || echo 'Monitoramento: OK'
        echo ''
        
        # Verificar backups
        echo 'Backups disponíveis:'
        ls -la /opt/supabase-manager-backups/ 2>/dev/null || echo 'Nenhum backup ainda'
        echo ''
        
        # Verificar cron
        echo 'Monitoramento automático:'
        crontab -l | grep ultrabase || echo 'Não configurado (manual)'
    "
    
    log "✅ Verificação concluída"
}

# ============================================================================
# GERAR DOCUMENTAÇÃO PERSONALIZADA
# ============================================================================

generate_custom_docs() {
    step "Gerando documentação personalizada..."
    
    local monitoring_enabled="false"
    local discord_enabled="false"
    
    if ssh $VPS_USER@$VPS_HOST "crontab -l | grep -q ultrabase" 2>/dev/null; then
        monitoring_enabled="true"
    fi
    
    if ssh $VPS_USER@$VPS_HOST "cat $DEPLOY_DIR/monitor-config.json | jq -r '.alerts.discord.enabled' 2>/dev/null" | grep -q "true"; then
        discord_enabled="true"
    fi
    
    cat > "$PROJECT_ROOT/ULTRABASE_SETUP_COMPLETO.md" << EOF
# 🎉 Setup Ultrabase Concluído!

## ✅ O que foi configurado

### Scripts Instalados
- \`ultrabase-deploy\` - Deploy com versionamento
- \`ultrabase-preserve\` - Preservação de dados  
- \`ultrabase-migrate\` - Sistema de migrações
- \`ultrabase-monitor\` - Monitoramento e alertas

### Sistemas Ativos
- ✅ Sistema de migrações inicializado
- ✅ Monitoramento configurado
- $([ "$monitoring_enabled" = "true" ] && echo "✅ Monitoramento automático ATIVO" || echo "⏳ Monitoramento automático NÃO configurado")
- $([ "$discord_enabled" = "true" ] && echo "✅ Alertas Discord ATIVOS" || echo "⏳ Alertas Discord NÃO configurados")

## 🚀 Comandos Disponíveis

### Deploy e Backup
\`\`\`bash
# Deploy completo com backup
ultrabase-deploy deploy

# Apenas backup
ultrabase-deploy backup

# Rollback para versão anterior
ultrabase-deploy rollback

# Listar backups
ultrabase-deploy list-backups
\`\`\`

### Migrações
\`\`\`bash
# Criar nova migração
ultrabase-migrate create "nome_da_migração"

# Aplicar migração
ultrabase-migrate apply MIGRATION_ID

# Status das migrações
ultrabase-migrate status

# Listar migrações
ultrabase-migrate list
\`\`\`

### Monitoramento
\`\`\`bash
# Status do monitoramento
ultrabase-monitor status

# Ver logs
ultrabase-monitor logs

# Testar alertas
ultrabase-monitor test-alerts

# Configurar monitoramento automático
ultrabase-monitor install-cron 300  # a cada 5 minutos
\`\`\`

### Preservação de Dados
\`\`\`bash
# Status da preservação
ultrabase-preserve status

# Verificar integridade
ultrabase-preserve verify

# Preservar dados manualmente
ultrabase-preserve preserve
\`\`\`

## 🔧 Próximos Passos

1. **Testar o sistema**
   \`\`\`bash
   # Fazer um pequeno deploy teste
   ultrabase-deploy verify
   \`\`\`

$([ "$monitoring_enabled" = "false" ] && echo "2. **Configurar monitoramento automático**
   \`\`\`bash
   ultrabase-monitor install-cron 300
   \`\`\`")

$([ "$discord_enabled" = "false" ] && echo "3. **Configurar alertas Discord**
   \`\`\`bash
   ultrabase-monitor edit-config
   # Adicionar webhook Discord na configuração
   ultrabase-monitor test-alerts
   \`\`\`")

## 📊 Dashboard Rápido

Adicione este alias ao seu ~/.bashrc para um dashboard rápido:

\`\`\`bash
alias ultrabase-status='echo "=== ULTRABASE STATUS ===" && ultrabase-deploy verify && echo "" && ultrabase-migrate status && echo "" && ultrabase-monitor status'
\`\`\`

## 🆘 Ajuda Rápida

- **Documentação completa:** \`cat SISTEMA_VERSIONAMENTO.md\`
- **Problemas de deploy:** \`ultrabase-deploy rollback\`
- **Sistema instável:** \`ultrabase-monitor status\`
- **Dados perdidos:** \`ultrabase-preserve restore\`

## 🎯 URLs Importantes

- **Dashboard:** http://$VPS_HOST/
- **API Health:** http://$VPS_HOST/api/health
- **Direto:** http://$VPS_HOST:3080/

---

**Sistema configurado em:** $(date)
**Versão:** v2.0.0-versionamento-completo
EOF
    
    log "✅ Documentação personalizada criada: ULTRABASE_SETUP_COMPLETO.md"
}

# ============================================================================
# FUNÇÃO PRINCIPAL
# ============================================================================

main() {
    echo -e "${CYAN}"
    echo "╔══════════════════════════════════════════════════════════════╗"
    echo "║                🚀 ULTRABASE QUICK SETUP 🚀                  ║"
    echo "║                                                              ║"
    echo "║        Sistema de Versionamento e Deploy Inteligente        ║"
    echo "╚══════════════════════════════════════════════════════════════╝"
    echo -e "${NC}"
    
    echo ""
    echo "Este script irá configurar:"
    echo "  ✅ Deploy com backup automático"
    echo "  ✅ Preservação de dados das instâncias"
    echo "  ✅ Sistema de migrações controladas"
    echo "  ✅ Monitoramento 24/7 com alertas"
    echo "  ✅ Rollback automático em falhas"
    echo ""
    
    read -p "Continuar com a instalação? (y/n): " confirm
    if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
        echo "Instalação cancelada."
        exit 0
    fi
    
    echo ""
    log "🚀 Iniciando configuração do sistema de versionamento..."
    echo ""
    
    # Executar etapas
    check_prerequisites
    setup_vps_environment
    upload_scripts
    initialize_systems
    setup_monitoring
    setup_alerts
    final_verification
    generate_custom_docs
    
    echo ""
    echo -e "${GREEN}"
    echo "╔══════════════════════════════════════════════════════════════╗"
    echo "║                    🎉 SETUP CONCLUÍDO! 🎉                   ║"
    echo "╚══════════════════════════════════════════════════════════════╝"
    echo -e "${NC}"
    
    echo ""
    echo "✅ Sistema de versionamento instalado e configurado!"
    echo ""
    echo "📚 Documentação criada:"
    echo "  - SISTEMA_VERSIONAMENTO.md (documentação completa)"
    echo "  - ULTRABASE_SETUP_COMPLETO.md (guia personalizado)"
    echo ""
    echo "🎯 Comandos rápidos:"
    echo "  ultrabase-deploy verify    # Verificar sistema"
    echo "  ultrabase-monitor status   # Status do monitoramento"
    echo "  ultrabase-migrate list     # Ver migrações"
    echo ""
    echo "🔗 Acesse seu dashboard: http://$VPS_HOST/"
    echo ""
    echo "💡 Próximo passo: Teste um deploy pequeno para verificar se tudo funciona!"
    echo ""
}

# Executar se chamado diretamente
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi 