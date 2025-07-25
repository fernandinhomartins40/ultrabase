# 🚀 Opções de Deploy - Ultrabase

Este documento resume todas as formas disponíveis para fazer deploy do seu sistema Ultrabase.

## 📋 **Métodos Disponíveis**

### 1. 🤖 **Deploy Automático - GitHub Actions (RECOMENDADO)**

#### 🧠 **Deploy Incremental Inteligente** *(Ativo)*
- **Arquivo**: `.github/workflows/deploy-incremental.yml`
- **Status**: ✅ Ativo
- **Trigger**: Push automático na branch `main`

**Vantagens:**
- ⚡ **80% mais rápido** para mudanças pequenas
- 🛡️ **Preservação total** de dados/instâncias
- 🧠 **Análise inteligente** do que mudou
- 📦 **Dependências condicionais** (só instala se necessário)
- 🔄 **Restart inteligente** (reload vs restart)
- 🚫 **Zero downtime** para docs/workflows

**Tipos de Deploy:**
- 📝 **Code-only**: 30-60s (mudanças em src/)
- 📦 **Full**: 2-3min (package.json mudou)
- ⚙️ **Config-only**: 1-2min (docker/config)
- 📋 **Minimal**: 10-30s (README/docs)

---

### 2. 🖥️ **Deploy Manual - SSH Direto**

#### 📜 **Script Bash Completo**
- **Arquivo**: `scripts/prepare-and-deploy.sh`
- **Uso**: `bash scripts/prepare-and-deploy.sh deploy`

**Vantagens:**
- 🎯 **Controle total** do processo
- 🔍 **Debug em tempo real** 
- 🛡️ **Preservação garantida** de dados
- ⚡ **Execução local** (sem dependência do GitHub)

**Opções:**
```bash
# Deploy completo (preparar VPS + deploy)
bash scripts/prepare-and-deploy.sh full

# Apenas deploy (VPS já preparada)
bash scripts/prepare-and-deploy.sh deploy

# Apenas preparar VPS
bash scripts/prepare-and-deploy.sh prepare
```

---

### 3. 🔧 **Deploy Manual - SSH Interativo**

#### 🖱️ **Comandos Diretos na VPS**
```bash
# Conectar na VPS
ssh root@82.25.69.57

# Atualizar código
cd /opt/supabase-manager
git pull origin main

# Reinstalar dependências (se necessário)
cd src && npm install --production

# Reiniciar aplicação
pm2 restart supabase-manager
```

**Quando usar:**
- 🐛 Debugging de problemas
- 🔧 Configurações específicas
- 🎯 Mudanças muito pontuais

---

## 📊 **Comparação dos Métodos**

| Aspecto | Deploy Incremental | Script Manual | SSH Direto |
|---------|-------------------|---------------|-------------|
| **Automação** | ✅ Total | ⚡ Semi-auto | ❌ Manual |
| **Velocidade** | ⚡ 30s-3min | 🔄 2-5min | 🐌 5-10min |
| **Preservação** | ✅ Automática | ✅ Garantida | ⚠️ Manual |
| **Inteligência** | 🧠 Analisa mudanças | 🔧 Básica | ❌ Nenhuma |
| **Debug** | 📋 Logs GitHub | 🔍 Tempo real | 🎯 Total |
| **Dependência** | 🌐 GitHub Actions | 💻 Local | 🖥️ SSH |

## 🎯 **Recomendações de Uso**

### 📝 **Para Desenvolvimento Diário:**
```bash
✅ USE: Deploy Incremental (GitHub Actions)
- Push suas mudanças normalmente
- Sistema detecta automaticamente o tipo
- Deploy otimizado é executado
- Zero configuração necessária
```

### 🐛 **Para Debugging/Problemas:**
```bash
✅ USE: Script Manual (scripts/prepare-and-deploy.sh)
- Controle total do processo
- Logs em tempo real
- Pode parar/continuar conforme necessário
```

### 🔧 **Para Configurações Específicas:**
```bash
✅ USE: SSH Direto
- Acesso total à VPS
- Modificações pontuais
- Investigação de problemas
```

## 📦 **Workflows Disponíveis**

### ✅ **Ativos:**
- `deploy-incremental.yml` - Deploy inteligente principal

### 🚫 **Desabilitados (para referência):**
- `deploy-simple.yml.disabled` - Deploy simples que funcionou
- `deploy-with-versioning.yml.disabled` - Deploy complexo original

## 🛡️ **Garantias de Segurança**

**Todos os métodos garantem:**
- ✅ **instances.json preservado** - Suas instâncias nunca são perdidas
- ✅ **Backup automático** - Antes de mudanças críticas
- ✅ **Rollback possível** - Backups em `/opt/supabase-manager-backups/`
- ✅ **Health check** - Verificação pós-deploy
- ✅ **Logs detalhados** - Rastreabilidade completa

## 🎯 **URLs de Acesso Pós-Deploy**

- **🎨 Dashboard**: http://82.25.69.57/
- **🔧 API**: http://82.25.69.57:3080/
- **❤️ Health Check**: http://82.25.69.57:3080/api/health
- **📊 GitHub Actions**: https://github.com/fernandinhomartins40/ultrabase/actions

## 📱 **Monitoramento**

### 🔍 **Verificar Deploy em Andamento:**
- GitHub Actions: https://github.com/fernandinhomartins40/ultrabase/actions
- SSH: `ssh root@82.25.69.57 "pm2 list"`

### 📊 **Status da Aplicação:**
```bash
curl http://82.25.69.57:3080/api/health
```

### 💾 **Verificar Backups:**
```bash
ssh root@82.25.69.57 "ls -la /opt/supabase-manager-backups/"
```

---

**🌟 Sistema completo com múltiplas opções para diferentes necessidades, sempre preservando seus dados!** 