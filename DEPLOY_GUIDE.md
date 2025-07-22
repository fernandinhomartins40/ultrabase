# 🚀 Guia de Deploy - Supabase Instance Manager

## 📋 Deploy Automático via GitHub Actions

### 🔧 Configuração Inicial

1. **Configure o Secret no GitHub**:
   - Vá em: `Settings` → `Secrets and variables` → `Actions`
   - Adicione o secret: `VPS_PASSWORD` com a senha do VPS

2. **Verifique as credenciais no arquivo de deploy**:
   ```yaml
   env:
     VPS_HOST: '82.25.69.57'    # ✅ Já configurado
     VPS_USER: 'root'           # ✅ Já configurado  
     APP_DIR: '/opt/supabase-manager'
   ```

### 🚀 Executar Deploy

**Opção 1: Push para main**
```bash
git add .
git commit -m "Deploy Supabase Instance Manager"
git push origin main
```

**Opção 2: Deploy manual**
- Vá em `Actions` no GitHub
- Clique em `Deploy Supabase Instance Manager to VPS Hostinger`
- Clique em `Run workflow`

---

## 📊 O que o Deploy Faz

### ✅ Etapas Executadas Automaticamente

1. **Preparação do Ambiente**
   - Para gerenciador existente
   - Para todas as instâncias Supabase ativas
   - Cria diretório `/opt/supabase-manager`

2. **Download do Código**
   - Clona/atualiza repositório do GitHub
   - Verifica integridade dos arquivos
   - Confirma estrutura do projeto

3. **Instalação de Dependências**
   - Docker & Docker Compose
   - Node.js 18+ 
   - PM2 para gerenciamento de processos
   - Dependências NPM do projeto

4. **Configuração da Aplicação**
   - Instala dependências NPM
   - Configura variáveis de ambiente
   - Cria arquivos de log
   - Configura permissões

5. **Configuração de Firewall**
   - Porta 3080 (gerenciador)
   - Portas 8100-8199 (Kong HTTP)
   - Portas 8400-8499 (Kong HTTPS)  
   - Portas 5500-5599 (PostgreSQL)
   - Portas 4100-4199 (Analytics)

6. **Inicialização da Aplicação**
   - Inicia com PM2
   - Configura auto-restart
   - Salva configuração PM2

7. **Configuração do Proxy Reverso**
   - Instala e configura Nginx
   - Configura proxy para porta 3080
   - Habilita acesso via porta 80

8. **Verificações de Saúde**
   - Verifica se aplicação está online
   - Testa endpoints HTTP
   - Verifica logs de inicialização

---

## 🌐 URLs Disponíveis Após Deploy

### 🎮 Interface Principal
```
http://82.25.69.57/
```
**Dashboard completo do gerenciador** (igual ao supabase.com)

### 🔗 API Direta
```
http://82.25.69.57/api/health      # Health check
http://82.25.69.57/api/instances   # Lista projetos
```

### 📱 Acesso Direto por Porta
```
http://82.25.69.57:3080/           # Dashboard direto
```

### 🏢 Instâncias Supabase (após criar projetos)
```
http://82.25.69.57:8101/           # Primeiro projeto
http://82.25.69.57:8102/           # Segundo projeto  
http://82.25.69.57:8103/           # Terceiro projeto
...
```

---

## 🎯 Como Usar Após Deploy

### 1. Acessar Dashboard
```
http://82.25.69.57
```

### 2. Criar Primeiro Projeto
1. Clique **"Criar Novo Projeto"**
2. Nome: `meu-primeiro-app`
3. Organização: `Minha Empresa` (opcional)
4. Clique **"Criar Projeto"**
5. Aguarde 30-60 segundos

### 3. Acessar Studio do Projeto
- O dashboard mostrará o link direto
- Ex: `http://82.25.69.57:8101`
- Clique em **"Abrir Studio"**

### 4. Gerenciar Projetos
- **▶️ Iniciar**: Projetos parados
- **⏸️ Parar**: Projetos ativos
- **📄 Ver Logs**: Debug de problemas
- **🗑️ Remover**: Deletar projeto

---

## 🔧 Comandos Úteis no Servidor

### PM2 (Gerenciador de Processos)
```bash
# Ver status
pm2 status

# Ver logs em tempo real
pm2 logs supabase-manager

# Restart aplicação
pm2 restart supabase-manager

# Parar aplicação
pm2 stop supabase-manager
```

### Docker (Instâncias Supabase)
```bash
# Ver containers ativos
docker ps

# Ver todas as instâncias
ls /opt/supabase-manager/supabase-core/docker-compose-*.yml

# Logs de uma instância específica
cd /opt/supabase-manager/supabase-core
docker compose -f docker-compose-XXXXX.yml logs
```

### Nginx (Proxy Reverso)
```bash
# Status do Nginx
systemctl status nginx

# Recarregar configuração
systemctl reload nginx

# Ver logs
tail -f /var/log/nginx/access.log
```

### Sistema
```bash
# Ver portas em uso
netstat -tulpn | grep :3080

# Ver uso de recursos
htop

# Ver logs do sistema
journalctl -f
```

---

## 🚨 Resolução de Problemas

### Deploy Falhou
1. **Verificar logs do GitHub Actions**
2. **Conectar no servidor via SSH**:
   ```bash
   ssh root@82.25.69.57
   cd /opt/supabase-manager/src
   pm2 logs supabase-manager
   ```

### Aplicação Não Inicia
```bash
# Verificar se porta está livre
lsof -i :3080

# Verificar logs PM2
pm2 logs supabase-manager --lines 50

# Restart manual
pm2 restart supabase-manager
```

### Instância Supabase Não Cria
```bash
# Verificar se Docker está funcionando
docker version

# Verificar logs do gerenciador
pm2 logs supabase-manager

# Verificar permissões
ls -la /opt/supabase-manager/supabase-core/
```

### Nginx Não Funciona
```bash
# Verificar configuração
nginx -t

# Ver logs de erro
tail -f /var/log/nginx/error.log

# Restart Nginx
systemctl restart nginx
```

---

## 📊 Monitoramento

### Verificações de Saúde
```bash
# Health check da aplicação
curl http://82.25.69.57/api/health

# Verificar instâncias
curl http://82.25.69.57/api/instances

# Status dos serviços
systemctl status nginx
systemctl status docker
pm2 status
```

### Métricas do Sistema
```bash
# Uso de CPU e memória
top

# Espaço em disco
df -h

# Uso de rede
iftop
```

---

## 🔄 Atualizações

### Deploy Automático
- Qualquer push para `main` faz deploy automático
- Ou use `Run workflow` manual no GitHub Actions

### Deploy Manual
```bash
ssh root@82.25.69.57
cd /opt/supabase-manager
git pull origin main
cd src
npm install
pm2 restart supabase-manager
```

---

## 🎉 Resultado Final

Após o deploy bem-sucedido, você terá:

✅ **Dashboard funcionando** em `http://82.25.69.57`  
✅ **Criação de projetos** via interface web  
✅ **Instâncias isoladas** para cada projeto  
✅ **Acesso direto ao Studio** de cada projeto  
✅ **Proxy reverso** configurado  
✅ **Auto-restart** em caso de falhas  
✅ **Monitoramento** via PM2 e Nginx  
✅ **Firewall configurado** para as portas necessárias

### 🚀 Seu Supabase Cloud Privado Está Online!

**Acesse agora: http://82.25.69.57**

---

## 📞 Suporte

Se encontrar problemas:

1. **Verificar logs**: `pm2 logs supabase-manager`
2. **Verificar GitHub Actions**: Aba Actions do repositório
3. **Conectar no servidor**: `ssh root@82.25.69.57`
4. **Verificar documentação**: `README.md`

**Status do deploy**: Verifique na aba Actions do GitHub