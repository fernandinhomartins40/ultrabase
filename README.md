# 🚀 Supabase Instance Manager

> **Painel web profissional para gerenciar múltiplas instâncias Supabase isoladas em uma única VPS**

Interface idêntica ao supabase.com que transforma o processo manual de criar instâncias em uma experiência visual e intuitiva.

---

## ✨ **Features**

🎨 **Interface Visual**
- Dashboard idêntico ao Supabase Cloud
- Criação de projetos com um clique
- Monitoramento em tempo real
- URLs diretas para cada Studio

🔐 **Isolamento Completo** 
- JWT único por projeto
- Volumes e networks separados
- Portas dinâmicas automáticas
- Auth completamente isolado

🐳 **Integração Docker**
- Usa scripts oficiais do Supabase
- Containers isolados por projeto
- Backup e restore automático
- Kong configurado automaticamente

---

## 🏗️ **Estrutura do Projeto**

```
supabase-instance-manager/
├── README.md              # 📋 Este arquivo
├── LICENSE                # ⚖️ Licença MIT
├── DEPLOY_GUIDE.md        # 🚀 Guia de deploy
├── docs/                  # 📚 Documentação
│   ├── ADAPTACAO.md       # Como foi adaptado
│   └── LIMPEZA.md         # Histórico da limpeza
├── src/                   # 🚀 Aplicação principal
│   ├── server.js          # Backend do gerenciador
│   ├── public/            # Frontend
│   │   └── index.html     # Interface web
│   ├── package.json       # Dependências Node.js
│   └── docker/            # Configs de deploy
│       ├── Dockerfile.production
│       ├── docker-compose.production.yml
│       ├── install.sh
│       └── nginx.conf
└── supabase-core/         # 🐳 Core Supabase
    ├── docker-compose.yml # Template principal
    ├── .env.template      # Template de variáveis
    ├── generate.bash      # Script original
    ├── generate-adapted.bash # Script adaptado
    └── volumes/           # Arquivos base
        ├── api/kong.yml   # Configuração Kong
        ├── db/            # Scripts PostgreSQL
        ├── functions/     # Edge Functions base
        └── logs/          # Configuração de logs
```

---

## 🚀 **Quick Start**

### **1. Deploy Automático (Recomendado)**

```bash
git push origin main
```
GitHub Actions faz deploy automático na VPS.

### **2. Deploy Manual**

```bash
# Na VPS
cd /opt
git clone <seu-repo> supabase-manager
cd supabase-manager
chmod +x src/docker/install.sh
./src/docker/install.sh
```

### **3. Primeiro Uso**

1. **Acesse**: `http://82.25.69.57`
2. **Clique**: "Criar Novo Projeto"  
3. **Nome**: `meu-primeiro-app`
4. **Aguarde**: 2-3 minutos (primeira vez)
5. **Acesse**: Studio link automático

---

## 🎯 **Como Funciona**

### **Fluxo de Criação**
```
👤 Usuário → 🌐 Interface → ⚙️ Backend → 🐳 generate-adapted.bash → 📊 Studio Online
```

### **URLs Geradas**
```
http://82.25.69.57:8101  # Primeiro projeto
http://82.25.69.57:8102  # Segundo projeto  
http://82.25.69.57:8103  # Terceiro projeto
...
```

### **Credenciais Padrão**
- **Kong**: `admin` / `admin` (automático)
- **PostgreSQL**: Senha gerada (visível no dashboard)

---

## 🛠️ **Tecnologias**

**Backend**
- Node.js + Express
- Docker + Docker Compose
- Shell Scripts (Bash)

**Frontend** 
- HTML5 + CSS3 + Vanilla JS
- Interface responsiva
- Real-time WebSocket

**Infraestrutura**
- Supabase Self-Hosted
- Kong Gateway
- PostgreSQL
- Nginx Proxy

---

## 📊 **Vantagens**

### ✅ **VS Supabase Cloud**
- ✅ **Custo**: $0 após VPS
- ✅ **Controle**: Dados na sua VPS
- ✅ **Privacidade**: Sem third-party
- ✅ **Customização**: Modificações livres

### ✅ **VS Docker Manual**  
- ✅ **Interface**: Dashboard visual
- ✅ **Automação**: Um clique para criar
- ✅ **Gerenciamento**: Fácil start/stop/delete
- ✅ **URLs**: Links diretos automáticos

---

## 🔧 **Comandos Úteis**

### **PM2 (Aplicação)**
```bash
pm2 status                    # Ver status
pm2 logs supabase-manager     # Ver logs
pm2 restart supabase-manager  # Reiniciar
```

### **Docker (Instâncias)**
```bash
docker ps                     # Ver containers
docker compose -f docker-compose-XXXXX.yml logs  # Logs específicos
```

### **Nginx (Proxy)**
```bash
systemctl status nginx        # Status
systemctl reload nginx        # Reload config
```

---

## 📋 **Requisitos**

**VPS Mínima**
- 2GB RAM
- 20GB SSD  
- Ubuntu 20.04+
- Docker + Docker Compose
- Node.js 18+

**Portas Necessárias**
- `3080` - Gerenciador
- `8100-8199` - Kong HTTP
- `8400-8499` - Kong HTTPS  
- `5500-5599` - PostgreSQL

---

## 🎉 **Resultado**

**Antes**: Processo manual complicado
```bash
cd docker/
./generate.bash
# Descobrir porta gerada
# Configurar manualmente
# Gerenciar via Docker CLI
```

**Depois**: Interface web intuitiva
```
📱 Dashboard profissional
🚀 Criar projeto: 1 clique
🎯 Abrir Studio: 1 clique  
📊 Monitorar: automático
🗑️ Remover: 1 clique
```

---

## 🆘 **Suporte**

**Problemas Comuns**
1. **App não inicia**: `pm2 logs supabase-manager`
2. **Docker erro**: `docker ps` + `systemctl status docker`  
3. **Nginx erro**: `nginx -t` + `systemctl status nginx`

**Logs Importantes**
- Aplicação: `pm2 logs supabase-manager`
- Nginx: `/var/log/nginx/error.log`
- Containers: `docker compose logs`

---

## 📄 **Documentação**

- 📋 **[DEPLOY_GUIDE.md](DEPLOY_GUIDE.md)** - Guia completo de deploy
- 🔧 **[docs/ADAPTACAO.md](docs/ADAPTACAO.md)** - Como foi adaptado  
- 🧹 **[docs/LIMPEZA.md](docs/LIMPEZA.md)** - Processo de limpeza

---

## 🤝 **Contribuição**

Este projeto é um wrapper visual em volta dos scripts oficiais do Supabase, mantendo 100% da compatibilidade original.

**Contribuições bem-vindas:**
- 🐛 Correções de bugs
- ✨ Novas funcionalidades  
- 📚 Melhorias na documentação
- 🧪 Testes automatizados

---

## ⚖️ **Licença**

MIT License - Use livremente para projetos pessoais e comerciais.

---

## 🎊 **Status**

✅ **Produção Ready**  
✅ **100% Funcional**  
✅ **Deploy Automático**  
✅ **Documentação Completa**  

**Acesse agora: http://82.25.69.57**

---

<div align="center">

**🚀 Seu Supabase Cloud Privado Está Funcionando! 🚀**

*Transforme instâncias Supabase em uma experiência visual profissional*

</div>