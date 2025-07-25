# 🔧 Guia de Troubleshooting - Deploy SSH

## 🚨 **Problemas Atuais Identificados**

### Erro Principal:
```
Load key "/home/runner/.ssh/id_rsa": error in libcrypto
Permission denied (publickey,password).
```

## 🔍 **Diagnóstico**

O erro indica que:
1. O GitHub Actions está tentando usar uma chave SSH que não existe ou está corrompida
2. A autenticação por senha pode não estar funcionando
3. Pode haver conflito entre chaves SSH e autenticação por senha

## ✅ **Soluções**

### **SOLUÇÃO 1: Forçar Autenticação por Senha (Mais Rápida)**

Atualize o arquivo `.github/workflows/deploy.yml`:

```yaml
- name: Deploy to VPS
  uses: appleboy/ssh-action@v1.0.3
  with:
    host: ${{ env.VPS_HOST }}
    username: ${{ env.VPS_USER }}
    password: ${{ secrets.VPS_PASSWORD }}
    port: 22
    timeout: 900s
    command_timeout: 900s
    # Força autenticação por senha, ignora chaves SSH
    key: ""
    passphrase: ""
    use_insecure_cipher: false
```

### **SOLUÇÃO 2: Configurar Chaves SSH (Mais Segura)**

#### 2.1 Gerar chave SSH no servidor:
```bash
# No seu VPS
ssh root@82.25.69.57

# Gerar chave SSH
ssh-keygen -t ed25519 -C "github-actions" -f /root/.ssh/github_deploy
# (não digite senha quando pedido)

# Adicionar chave pública ao authorized_keys
cat /root/.ssh/github_deploy.pub >> /root/.ssh/authorized_keys

# Mostrar chave privada (copie todo o conteúdo)
cat /root/.ssh/github_deploy
```

#### 2.2 Configurar no GitHub:
1. Vá para: `Settings` → `Secrets and variables` → `Actions`
2. Adicione uma nova secret chamada `SSH_PRIVATE_KEY`
3. Cole todo o conteúdo da chave privada (incluindo `-----BEGIN` e `-----END`)

#### 2.3 Atualizar workflow:
```yaml
- name: Deploy to VPS
  uses: appleboy/ssh-action@v1.0.3
  with:
    host: ${{ env.VPS_HOST }}
    username: ${{ env.VPS_USER }}
    key: ${{ secrets.SSH_PRIVATE_KEY }}
    port: 22
    timeout: 900s
    command_timeout: 900s
```

### **SOLUÇÃO 3: Verificar Configuração do Servidor**

#### 3.1 Habilitar autenticação por senha no SSH:
```bash
# No VPS, editar configuração SSH
nano /etc/ssh/sshd_config

# Garantir que estas linhas existem e estão corretas:
PasswordAuthentication yes
PubkeyAuthentication yes
PermitRootLogin yes

# Reiniciar SSH
systemctl restart sshd
```

#### 3.2 Verificar firewall:
```bash
# Verificar se porta 22 está aberta
ufw status
ufw allow 22/tcp
```

## 🔧 **Testes Locais**

### Testar autenticação SSH:
```bash
# Teste de senha
ssh root@82.25.69.57

# Teste de chave (se configurada)
ssh -i ~/.ssh/sua_chave root@82.25.69.57

# Verificar logs SSH no servidor
tail -f /var/log/auth.log
```

## 🚀 **Solução Recomendada AGORA**

Para resolver rapidamente, faça:

### 1. Verificar a senha no GitHub Secrets:
- Vá em `Settings` → `Secrets and variables` → `Actions`
- Verifique se `VPS_PASSWORD` existe e está correto
- Se necessário, atualize com a senha correta

### 2. Atualizar o workflow com configuração mais robusta:

```yaml
- name: Deploy to VPS
  uses: appleboy/ssh-action@v1.0.3
  with:
    host: ${{ env.VPS_HOST }}
    username: ${{ env.VPS_USER }}
    password: ${{ secrets.VPS_PASSWORD }}
    port: 22
    timeout: 900s
    command_timeout: 900s
    # Configurações adicionais para forçar autenticação por senha
    script_stop: true
    envs: VPS_HOST,VPS_USER,APP_DIR,MANAGER_PORT
```

### 3. Testar conectividade manual:
```bash
# Execute localmente para testar
ssh root@82.25.69.57 "echo 'Conexão OK'; exit 0"
```

## 📋 **Checklist de Verificação**

- [ ] Secret `VPS_PASSWORD` existe no GitHub
- [ ] Senha está correta
- [ ] Servidor SSH está rodando: `systemctl status sshd`
- [ ] Porta 22 está aberta no firewall
- [ ] `PasswordAuthentication yes` no SSH config
- [ ] `PermitRootLogin yes` no SSH config

## 🆘 **Se Nada Funcionar**

### Opção de Emergência - Deploy Manual:
```bash
# 1. Conectar no servidor
ssh root@82.25.69.57

# 2. Navegar para diretório
cd /opt/supabase-manager

# 3. Fazer pull manual
git pull origin main

# 4. Restart aplicação
pm2 restart supabase-manager
```

## 📞 **Próximos Passos**

1. **IMEDIATO**: Implementar Solução 1 (autenticação por senha)
2. **DEPOIS**: Migrar para Solução 2 (chaves SSH) para maior segurança
3. **FUTURO**: Implementar CI/CD com Docker para deploys mais robustos

---

**💡 Dica**: Sempre teste a conectividade SSH manualmente antes de executar o workflow do GitHub Actions. 