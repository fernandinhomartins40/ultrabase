#!/bin/bash

# 🔧 Script de Verificação SSH para Deploy
# Execute este script no seu VPS: bash check_ssh_config.sh

echo "🔍 VERIFICANDO CONFIGURAÇÃO SSH PARA DEPLOY..."
echo "=============================================="

# Verificar se SSH está rodando
echo "1. Status do serviço SSH:"
if systemctl is-active --quiet sshd; then
    echo "   ✅ SSH está rodando"
else
    echo "   ❌ SSH não está rodando"
    echo "   🔧 Execute: systemctl start sshd"
fi

# Verificar configurações SSH
echo ""
echo "2. Configurações SSH importantes:"
SSH_CONFIG="/etc/ssh/sshd_config"

if [ -f "$SSH_CONFIG" ]; then
    echo "   📄 Arquivo de config encontrado: $SSH_CONFIG"
    
    # Verificar PasswordAuthentication
    if grep -q "^PasswordAuthentication yes" "$SSH_CONFIG"; then
        echo "   ✅ PasswordAuthentication está habilitado"
    elif grep -q "^PasswordAuthentication no" "$SSH_CONFIG"; then
        echo "   ❌ PasswordAuthentication está desabilitado"
        echo "   🔧 Execute: sed -i 's/^PasswordAuthentication no/PasswordAuthentication yes/' $SSH_CONFIG"
    else
        echo "   ⚠️ PasswordAuthentication não configurado explicitamente"
        echo "   🔧 Execute: echo 'PasswordAuthentication yes' >> $SSH_CONFIG"
    fi
    
    # Verificar PubkeyAuthentication
    if grep -q "^PubkeyAuthentication yes" "$SSH_CONFIG"; then
        echo "   ✅ PubkeyAuthentication está habilitado"
    elif grep -q "^PubkeyAuthentication no" "$SSH_CONFIG"; then
        echo "   ⚠️ PubkeyAuthentication está desabilitado"
    else
        echo "   ✅ PubkeyAuthentication padrão (habilitado)"
    fi
    
    # Verificar PermitRootLogin
    if grep -q "^PermitRootLogin yes" "$SSH_CONFIG"; then
        echo "   ✅ PermitRootLogin está habilitado"
    elif grep -q "^PermitRootLogin no" "$SSH_CONFIG"; then
        echo "   ❌ PermitRootLogin está desabilitado"
        echo "   🔧 Execute: sed -i 's/^PermitRootLogin no/PermitRootLogin yes/' $SSH_CONFIG"
    else
        echo "   ⚠️ PermitRootLogin não configurado explicitamente"
        echo "   🔧 Execute: echo 'PermitRootLogin yes' >> $SSH_CONFIG"
    fi
else
    echo "   ❌ Arquivo de configuração SSH não encontrado!"
fi

# Verificar porta SSH
echo ""
echo "3. Porta SSH:"
SSH_PORT=$(grep "^Port " "$SSH_CONFIG" 2>/dev/null | awk '{print $2}')
if [ -z "$SSH_PORT" ]; then
    SSH_PORT="22"
    echo "   ✅ Usando porta padrão: 22"
else
    echo "   ℹ️ Usando porta customizada: $SSH_PORT"
fi

# Verificar se porta está aberta
if ss -tlnp | grep -q ":$SSH_PORT "; then
    echo "   ✅ Porta $SSH_PORT está aberta"
else
    echo "   ❌ Porta $SSH_PORT não está escutando"
fi

# Verificar firewall
echo ""
echo "4. Status do Firewall:"
if command -v ufw >/dev/null 2>&1; then
    UFW_STATUS=$(ufw status | head -1)
    echo "   📊 UFW: $UFW_STATUS"
    
    if ufw status | grep -q "^$SSH_PORT"; then
        echo "   ✅ Porta SSH $SSH_PORT está permitida no UFW"
    else
        echo "   ⚠️ Porta SSH $SSH_PORT pode não estar permitida no UFW"
        echo "   🔧 Execute: ufw allow $SSH_PORT/tcp"
    fi
else
    echo "   ℹ️ UFW não está instalado"
fi

# Verificar usuário root
echo ""
echo "5. Usuário root:"
if id root >/dev/null 2>&1; then
    echo "   ✅ Usuário root existe"
    
    # Verificar se root tem senha
    if passwd -S root 2>/dev/null | grep -q " P "; then
        echo "   ✅ Usuário root tem senha configurada"
    else
        echo "   ❌ Usuário root pode não ter senha"
        echo "   🔧 Execute: passwd root"
    fi
else
    echo "   ❌ Usuário root não encontrado"
fi

# Verificar logs SSH recentes
echo ""
echo "6. Logs SSH recentes (últimas 10 linhas):"
if [ -f "/var/log/auth.log" ]; then
    echo "   📋 Últimas tentativas de login:"
    tail -10 /var/log/auth.log | grep -i ssh | tail -5
else
    echo "   ⚠️ Log de autenticação não encontrado"
fi

# Teste de conectividade local
echo ""
echo "7. Teste de conectividade local:"
if nc -z localhost $SSH_PORT 2>/dev/null; then
    echo "   ✅ Conexão local para porta $SSH_PORT: OK"
else
    echo "   ❌ Conexão local para porta $SSH_PORT: FALHOU"
fi

# Resumo de ações necessárias
echo ""
echo "=============================================="
echo "🚀 AÇÕES RECOMENDADAS:"
echo ""

# Verificar se precisa de correções
NEEDS_FIX=false

if ! systemctl is-active --quiet sshd; then
    echo "1. ⚡ Iniciar SSH: systemctl start sshd && systemctl enable sshd"
    NEEDS_FIX=true
fi

if ! grep -q "^PasswordAuthentication yes" "$SSH_CONFIG"; then
    echo "2. 🔑 Habilitar autenticação por senha:"
    echo "   echo 'PasswordAuthentication yes' >> $SSH_CONFIG"
    NEEDS_FIX=true
fi

if ! grep -q "^PermitRootLogin yes" "$SSH_CONFIG"; then
    echo "3. 👤 Permitir login root:"
    echo "   echo 'PermitRootLogin yes' >> $SSH_CONFIG"
    NEEDS_FIX=true
fi

if [ "$NEEDS_FIX" = true ]; then
    echo ""
    echo "4. 🔄 Depois das alterações, reinicie o SSH:"
    echo "   systemctl restart sshd"
    echo ""
    echo "5. 🧪 Teste a conexão:"
    echo "   ssh root@82.25.69.57 'echo Conexão OK'"
else
    echo "✅ Configuração SSH parece estar correta!"
    echo ""
    echo "🧪 Teste final:"
    echo "   ssh root@82.25.69.57 'echo Conexão OK'"
fi

echo ""
echo "💡 Se ainda tiver problemas, verifique:"
echo "   - Senha do usuário root está correta"
echo "   - Firewall da Hostinger permite porta 22"
echo "   - Secret VPS_PASSWORD no GitHub está correto"
echo ""
echo "==============================================" 