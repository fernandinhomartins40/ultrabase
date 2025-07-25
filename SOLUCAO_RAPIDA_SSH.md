# 🚀 Solução Rápida - Problemas de Deploy SSH

## ⚡ **Solução IMEDIATA** (5 minutos)

### 1. **Acesse seu VPS via SSH:**
```bash
ssh root@82.25.69.57
```

### 2. **Execute o script de correção:**
```bash
curl -s https://raw.githubusercontent.com/fernandinhomartins40/ultrabase/main/fix_ssh_deploy.sh | bash
```

**OU** copie e cole este comando completo:

```bash
# Script de correção rápida
cat > /tmp/fix_ssh.sh << 'EOF'
#!/bin/bash
echo "🔧 Corrigindo SSH..."

# Backup
cp /etc/ssh/sshd_config /etc/ssh/sshd_config.backup

# Configurar SSH
sed -i 's/^#*PasswordAuthentication.*/PasswordAuthentication yes/' /etc/ssh/sshd_config
sed -i 's/^#*PermitRootLogin.*/PermitRootLogin yes/' /etc/ssh/sshd_config
sed -i 's/^#*PubkeyAuthentication.*/PubkeyAuthentication yes/' /etc/ssh/sshd_config

# Adicionar se não existir
grep -q "^PasswordAuthentication" /etc/ssh/sshd_config || echo "PasswordAuthentication yes" >> /etc/ssh/sshd_config
grep -q "^PermitRootLogin" /etc/ssh/sshd_config || echo "PermitRootLogin yes" >> /etc/ssh/sshd_config

# Reiniciar SSH
systemctl restart sshd

echo "✅ SSH configurado com sucesso!"
echo "🧪 Teste: ssh root@82.25.69.57 'echo Conexão OK'"
EOF

bash /tmp/fix_ssh.sh
```

### 3. **Verificar GitHub Secrets:**
- Vá para: `Settings` → `Secrets and variables` → `Actions`
- Confirme que `VPS_PASSWORD` existe e tem a senha correta do root

### 4. **Executar deploy novamente no GitHub Actions**

---

## 🔧 **O que Foi Corrigido:**

✅ **Workflow atualizado** (já feito):
- Versão mais nova do `appleboy/ssh-action@v1.0.3`
- Forçar autenticação por senha
- Ignorar chaves SSH com problemas

✅ **Configuração SSH no servidor**:
- `PasswordAuthentication yes`
- `PermitRootLogin yes` 
- `PubkeyAuthentication yes`

---

## 🎯 **Resolução de Problemas Específicos:**

### **Erro: "Load key error in libcrypto"**
**Causa**: GitHub Actions tentando usar chave SSH inexistente
**Solução**: Workflow foi atualizado para ignorar chaves e usar senha

### **Erro: "Permission denied (publickey,password)"**
**Causa**: Configuração SSH não permite autenticação por senha
**Solução**: Script de correção habilita autenticação por senha

---

## 📋 **Checklist de Verificação:**

- [ ] SSH está rodando: `systemctl status sshd`
- [ ] Porta 22 aberta: `ss -tlnp | grep :22`
- [ ] Autenticação por senha habilitada: `grep PasswordAuthentication /etc/ssh/sshd_config`
- [ ] Login root permitido: `grep PermitRootLogin /etc/ssh/sshd_config`
- [ ] Secret `VPS_PASSWORD` correto no GitHub
- [ ] Workflow atualizado com nova versão

---

## 🚨 **Se AINDA não funcionar:**

### **Opção 1: Deploy Manual Temporário**
```bash
# 1. Conectar no servidor
ssh root@82.25.69.57

# 2. Atualizar código manualmente
cd /opt/supabase-manager
git pull origin main
cd src
npm install
pm2 restart supabase-manager
```

### **Opção 2: Chaves SSH (mais seguro)**
```bash
# No VPS, gerar chave SSH
ssh-keygen -t ed25519 -f /root/.ssh/github_deploy
cat /root/.ssh/github_deploy.pub >> /root/.ssh/authorized_keys

# Copiar chave privada
cat /root/.ssh/github_deploy

# Adicionar no GitHub como secret SSH_PRIVATE_KEY
# Atualizar workflow para usar key: ${{ secrets.SSH_PRIVATE_KEY }}
```

---

## ⏱️ **Timeline Esperado:**

- **2 min**: Executar script de correção no VPS
- **1 min**: Verificar GitHub Secrets  
- **2 min**: Executar deploy no GitHub Actions
- **5-10 min**: Deploy completo do Ultrabase

---

## 🎉 **Depois da Correção:**

Seu deploy deve funcionar normalmente e você verá:
```
✅ Deploy do Supabase Instance Manager concluído com sucesso!
🌐 Aplicação disponível em: http://82.25.69.57
```

---

**💡 Prioridade**: Execute a **Solução IMEDIATA** primeiro. É a forma mais rápida de resolver! 