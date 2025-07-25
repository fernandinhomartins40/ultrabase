# 🚀 Deploy Manual - Ultrabase

Este guia permite fazer deploy manual via SSH, evitando os problemas dos workflows do GitHub Actions.

## 📋 Pré-requisitos

1. **Acesso SSH configurado** para a VPS
2. **Git** instalado localmente
3. **rsync** disponível (ou usar SCP como alternativa)

## 🔧 Como usar

### 1. Preparar e fazer deploy completo (recomendado)

```bash
# Executar do diretório raiz do projeto
bash scripts/prepare-and-deploy.sh full
```

### 2. Apenas preparar a VPS (primeira execução)

```bash
bash scripts/prepare-and-deploy.sh prepare
```

### 3. Apenas fazer deploy (VPS já preparada)

```bash
bash scripts/prepare-and-deploy.sh deploy
```

## 🛡️ Segurança dos dados

O script **automaticamente preserva**:
- ✅ Configurações de instâncias (`instances.json`)
- ✅ Logs existentes
- ✅ Volumes Docker das instâncias
- ✅ Todos os dados do banco de dados

## 📊 O que o script faz

### Preparação da VPS:
1. 🔄 Atualiza o sistema operacional
2. 📦 Instala Node.js, PM2, Docker, nginx
3. 🔥 Configura firewall (portas 80, 443, 3080, 8000-8999)
4. 🛡️ Configura fail2ban para segurança
5. 📁 Cria diretórios necessários

### Deploy:
1. 💾 **Backup completo** dos dados existentes
2. 📤 Envia código atualizado via rsync
3. 🔄 **Restaura dados preservados**
4. 📦 Instala dependências NPM
5. 🚀 Reinicia aplicação com PM2
6. 🌐 Configura nginx
7. ✅ Verifica se tudo está funcionando

## 🎯 URLs após deploy

- **Dashboard**: http://82.25.69.57/
- **API**: http://82.25.69.57:3080/
- **Health Check**: http://82.25.69.57:3080/api/health

## 🆘 Solução de problemas

### Erro de SSH
```bash
# Verificar conexão SSH
ssh root@82.25.69.57 "echo 'Conexão OK'"
```

### Aplicação não responde
```bash
# Verificar logs do PM2
ssh root@82.25.69.57 "pm2 logs supabase-manager"

# Reiniciar aplicação
ssh root@82.25.69.57 "pm2 restart supabase-manager"
```

### Verificar backups
```bash
# Listar backups disponíveis
ssh root@82.25.69.57 "ls -la /opt/supabase-manager-backups/"
```

## 🔄 Rollback manual

Se algo der errado, você pode restaurar o backup mais recente:

```bash
ssh root@82.25.69.57
cd /opt/supabase-manager-backups
LATEST_BACKUP=$(ls -t backup_* | head -1)
echo "Backup mais recente: $LATEST_BACKUP"

# Parar aplicação
pm2 stop supabase-manager

# Restaurar backup
cd /opt/supabase-manager
tar -xzf "/opt/supabase-manager-backups/$LATEST_BACKUP/application-code.tar.gz" .

# Reiniciar
cd src && pm2 restart supabase-manager
```

## 📝 Logs importantes

- **Aplicação**: `pm2 logs supabase-manager`
- **Nginx**: `/var/log/nginx/error.log`
- **Sistema**: `journalctl -f`

## ⚠️ Importante

- O script **preserva totalmente** seus dados existentes
- Backups são criados automaticamente antes de cada deploy
- Em caso de erro, o sistema mantém a versão anterior funcionando
- Teste sempre o health check após o deploy: http://82.25.69.57:3080/api/health 