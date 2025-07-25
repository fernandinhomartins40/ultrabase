#!/bin/bash

# Script para corrigir SSH e executar deploy com versionamento
set -e

VPS_HOST="${VPS_HOST:-82.25.69.57}"
VPS_USER="${VPS_USER:-root}"

echo "🔧 Corrigindo configuração SSH..."

# Remover chave antiga
ssh-keygen -f ~/.ssh/known_hosts -R "$VPS_HOST" 2>/dev/null || true

# Conectar uma vez para aceitar nova chave
echo "📡 Testando conexão SSH e aceitando nova chave..."
ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=~/.ssh/known_hosts $VPS_USER@$VPS_HOST "echo 'SSH funcionando!' && date" || {
    echo "❌ Falha na conexão SSH. Verifique se:"
    echo "   - A chave SSH está configurada: ~/.ssh/ultrabase_key"
    echo "   - As permissões estão corretas: chmod 600 ~/.ssh/ultrabase_key"
    echo "   - O servidor está acessível: ping $VPS_HOST"
    exit 1
}

echo "✅ SSH configurado com sucesso!"

# Agora executar o deploy com versionamento
echo "🚀 Executando deploy com versionamento..."

# Modificar temporariamente o script para usar StrictHostKeyChecking=no
export SSH_OPTIONS="-o StrictHostKeyChecking=no -o UserKnownHostsFile=~/.ssh/known_hosts"

# Criar versão temporária do script de deploy com SSH corrigido
temp_script="/tmp/deploy-versioning-fixed.sh"
cp scripts/deploy-versioning.sh "$temp_script"

# Substituir chamadas SSH no script temporário
sed -i 's/ssh \$VPS_USER@\$VPS_HOST/ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=~\/.ssh\/known_hosts $VPS_USER@$VPS_HOST/g' "$temp_script"

# Executar o script corrigido
bash "$temp_script" deploy

# Limpar script temporário
rm -f "$temp_script"

echo "✅ Deploy com versionamento concluído!" 