#!/bin/bash

# 🔧 Script de Correção Automática SSH para Deploy
# Execute este script no seu VPS: bash fix_ssh_deploy.sh

set -e  # Parar se houver erro

echo "🔧 CORRIGINDO CONFIGURAÇÃO SSH PARA DEPLOY..."
echo "=============================================="

# Função de log
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
}

# Backup do arquivo de configuração SSH
SSH_CONFIG="/etc/ssh/sshd_config"
BACKUP_FILE="/etc/ssh/sshd_config.backup.$(date +%Y%m%d_%H%M%S)"

if [ -f "$SSH_CONFIG" ]; then
    log "📄 Fazendo backup da configuração SSH..."
    cp "$SSH_CONFIG" "$BACKUP_FILE"
    log "✅ Backup salvo em: $BACKUP_FILE"
else
    log "❌ Arquivo de configuração SSH não encontrado!"
    exit 1
fi

# 1. Habilitar autenticação por senha
log "🔑 Configurando autenticação por senha..."
if grep -q "^PasswordAuthentication" "$SSH_CONFIG"; then
    sed -i 's/^PasswordAuthentication.*/PasswordAuthentication yes/' "$SSH_CONFIG"
    log "✅ PasswordAuthentication atualizado"
else
    echo "PasswordAuthentication yes" >> "$SSH_CONFIG"
    log "✅ PasswordAuthentication adicionado"
fi

# 2. Permitir login root
log "👤 Configurando login root..."
if grep -q "^PermitRootLogin" "$SSH_CONFIG"; then
    sed -i 's/^PermitRootLogin.*/PermitRootLogin yes/' "$SSH_CONFIG"
    log "✅ PermitRootLogin atualizado"
else
    echo "PermitRootLogin yes" >> "$SSH_CONFIG"
    log "✅ PermitRootLogin adicionado"
fi

# 3. Habilitar autenticação por chave pública (para futuro)
log "🔐 Configurando autenticação por chave pública..."
if grep -q "^PubkeyAuthentication" "$SSH_CONFIG"; then
    sed -i 's/^PubkeyAuthentication.*/PubkeyAuthentication yes/' "$SSH_CONFIG"
    log "✅ PubkeyAuthentication atualizado"
else
    echo "PubkeyAuthentication yes" >> "$SSH_CONFIG"
    log "✅ PubkeyAuthentication adicionado"
fi

# 4. Configurar outras opções importantes
log "⚙️ Configurando opções adicionais..."

# Habilitar autenticação por teclado (para compatibilidade)
if ! grep -q "^KbdInteractiveAuthentication" "$SSH_CONFIG"; then
    echo "KbdInteractiveAuthentication yes" >> "$SSH_CONFIG"
    log "✅ KbdInteractiveAuthentication adicionado"
fi

# Desabilitar GSS API (pode causar problemas)
if ! grep -q "^GSSAPIAuthentication" "$SSH_CONFIG"; then
    echo "GSSAPIAuthentication no" >> "$SSH_CONFIG"
    log "✅ GSSAPIAuthentication desabilitado"
fi

# 5. Verificar se usuário root tem senha
log "🔍 Verificando senha do usuário root..."
if passwd -S root 2>/dev/null | grep -q " P "; then
    log "✅ Usuário root já tem senha configurada"
else
    log "⚠️ Configurando senha para usuário root..."
    echo "root:UltrabaseVPS2024!" | chpasswd
    log "✅ Senha temporária configurada para root"
    log "🔔 IMPORTANTE: Altere a senha com 'passwd root'"
fi

# 6. Configurar firewall
log "🛡️ Configurando firewall..."
if command -v ufw >/dev/null 2>&1; then
    # Permitir SSH
    ufw allow 22/tcp >/dev/null 2>&1 || true
    log "✅ Porta SSH (22) permitida no UFW"
    
    # Permitir portas do Ultrabase
    ufw allow 3080/tcp >/dev/null 2>&1 || true  # Manager
    ufw allow 8100:8199/tcp >/dev/null 2>&1 || true  # Kong HTTP
    ufw allow 5500:5599/tcp >/dev/null 2>&1 || true  # PostgreSQL
    
    log "✅ Portas do Ultrabase permitidas no UFW"
else
    log "ℹ️ UFW não está instalado"
fi

# 7. Reiniciar serviço SSH
log "🔄 Reiniciando serviço SSH..."
systemctl restart sshd
if systemctl is-active --quiet sshd; then
    log "✅ SSH reiniciado com sucesso"
else
    log "❌ Erro ao reiniciar SSH!"
    exit 1
fi

# 8. Testar configuração
log "🧪 Testando configuração..."
if ss -tlnp | grep -q ":22 "; then
    log "✅ SSH está escutando na porta 22"
else
    log "❌ SSH não está escutando na porta 22"
    exit 1
fi

# 9. Mostrar resumo da configuração
echo ""
echo "=============================================="
echo "📋 RESUMO DA CONFIGURAÇÃO SSH:"
echo "=============================================="
echo "✅ PasswordAuthentication: $(grep "^PasswordAuthentication" "$SSH_CONFIG" | awk '{print $2}')"
echo "✅ PermitRootLogin: $(grep "^PermitRootLogin" "$SSH_CONFIG" | awk '{print $2}')"
echo "✅ PubkeyAuthentication: $(grep "^PubkeyAuthentication" "$SSH_CONFIG" | awk '{print $2}')"
echo "✅ SSH Service: $(systemctl is-active sshd)"
echo ""

# 10. Instruções finais
echo "🎉 CONFIGURAÇÃO SSH CORRIGIDA COM SUCESSO!"
echo ""
echo "📝 PRÓXIMOS PASSOS:"
echo "==================="
echo ""
echo "1. 🔐 Alterar senha do root (opcional mas recomendado):"
echo "   passwd root"
echo ""
echo "2. 🧪 Testar conexão SSH localmente:"
echo "   ssh root@82.25.69.57 'echo Conexão OK'"
echo ""
echo "3. ✅ Verificar GitHub Secrets:"
echo "   - Vá para: Settings → Secrets and variables → Actions"
echo "   - Confirme que VPS_PASSWORD existe e está correto"
echo ""
echo "4. 🚀 Executar deploy no GitHub Actions"
echo ""
echo "💾 BACKUP:"
echo "Backup da configuração anterior salvo em:"
echo "$BACKUP_FILE"
echo ""
echo "🔄 Para reverter (se necessário):"
echo "   cp $BACKUP_FILE $SSH_CONFIG"
echo "   systemctl restart sshd"
echo ""
echo "=============================================="

# Opcional: Mostrar informações de conectividade
echo "🌐 INFORMAÇÕES DE CONECTIVIDADE:"
echo "================================"
echo "Host: 82.25.69.57"
echo "Usuário: root"
echo "Porta SSH: 22"
echo "Métodos de auth: password, publickey"
echo ""

log "✅ Script de correção concluído!"

# Teste final
echo "🔬 TESTE FINAL DE CONECTIVIDADE:"
echo "================================"
if nc -z localhost 22 >/dev/null 2>&1; then
    echo "✅ Porta 22 está acessível localmente"
else
    echo "❌ Porta 22 não está acessível"
fi

echo ""
echo "💡 Dica: Se ainda tiver problemas, verifique:"
echo "   - Firewall da Hostinger (painel de controle)"
echo "   - Logs do SSH: tail -f /var/log/auth.log"
echo "   - Status do serviço: systemctl status sshd" 