# 🚀 Ultrabase - Supabase Cloud Privado

## 🎯 Sobre o Projeto

O Ultrabase é um sistema que replica a experiência do Supabase Cloud, permitindo criar e gerenciar múltiplas instâncias Supabase isoladas em uma única VPS. 

**🆕 NOVO: Sistema de Versionamento Completo**
- ✅ Deploy sem perda de dados
- ✅ Backup automático 
- ✅ Rollback instantâneo
- ✅ Monitoramento 24/7
- ✅ Auto-recovery

## 🏗️ Arquitetura

```
┌─────────────────────────────────────────────────────────────┐
│                    🌐 Dashboard Web                          │
│               (Como supabase.com)                           │
└─────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────┐
│               📊 Sistema de Versionamento                    │
│  • Deploy Inteligente    • Monitoramento 24/7              │
│  • Backup Automático     • Auto-Recovery                   │
│  • Rollback Instantâneo  • Migrações Controladas          │
└─────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────┐
│                  ⚙️ Gerenciador Central                      │
│           (Node.js + Express + PM2)                        │
└─────────────────────────────────────────────────────────────┘
                              │
┌─────────────────┬─────────────────┬─────────────────┬───────┐
│   📦 Projeto 1   │   📦 Projeto 2   │   📦 Projeto 3   │  ...  │
│                 │                 │                 │       │
│ ┌─Studio────────┐│ ┌─Studio────────┐│ ┌─Studio────────┐│       │
│ │ :8101        ││ │ :8102        ││ │ :8103        ││       │
│ └──────────────┘│ └──────────────┘│ └──────────────┘│       │
│ ┌─PostgreSQL───┐│ ┌─PostgreSQL───┐│ ┌─PostgreSQL───┐│       │
│ │ :5501        ││ │ :5502        ││ │ :5503        ││       │
│ └──────────────┘│ └──────────────┘│ └──────────────┘│       │
│ ┌─Auth+API─────┐│ ┌─Auth+API─────┐│ ┌─Auth+API─────┐│       │
│ │ Kong Gateway ││ │ Kong Gateway ││ │ Kong Gateway ││       │
│ └──────────────┘│ └──────────────┘│ └──────────────┘│       │
└─────────────────┴─────────────────┴─────────────────┴───────┘
```

## 📦 O que está incluído

### 🎛️ Dashboard Completo
- Interface idêntica ao supabase.com
- Criação de projetos com um clique
- Gerenciamento de instâncias ativas
- Monitoramento de recursos e status

### 🔧 Componentes Técnicos
- **Supabase Studio** - Interface de administração
- **PostgreSQL** - Banco de dados isolado por projeto
- **Kong Gateway** - API Gateway e autenticação
- **Auth (GoTrue)** - Sistema de autenticação
- **Storage API** - Gerenciamento de arquivos
- **Edge Functions** - Funções serverless
- **Realtime** - WebSockets e subscriptions

### 🛡️ Sistema de Versionamento (NOVO)
- **Deploy Inteligente** - Preserva dados existentes
- **Backup Automático** - Antes de cada deploy
- **Rollback Instantâneo** - Para qualquer versão anterior
- **Monitoramento 24/7** - Com alertas Discord/Webhook
- **Auto-Recovery** - Sistema se recupera automaticamente
- **Migrações Controladas** - Mudanças incrementais seguras

## 🚀 Quick Start

### Configuração Automática (Recomendado)

```bash
# 1. Clone o repositório
git clone https://github.com/SEU_USUARIO/ultrabase.git
cd ultrabase

# 2. Execute o setup automático
./scripts/quick-setup.sh

# 3. Siga as instruções interativas
# O script irá configurar tudo automaticamente!
```

### Deploy Manual

```bash
# Via GitHub Actions (automático)
git push origin main

# Via script local
./scripts/deploy-versioning.sh deploy
```

## 🎯 URLs Disponíveis

### Dashboard Principal
```
http://82.25.69.57/
```

### API de Gerenciamento
```
http://82.25.69.57/api/health      # Health check
http://82.25.69.57/api/instances   # Lista projetos
```

### Instâncias Supabase (após criar projetos)
```
http://82.25.69.57:8101/           # Primeiro projeto
http://82.25.69.57:8102/           # Segundo projeto  
http://82.25.69.57:8103/           # Terceiro projeto
```

## 🛡️ Comandos do Sistema de Versionamento

### Deploy e Backup
```bash
ultrabase-deploy deploy          # Deploy completo
ultrabase-deploy backup          # Apenas backup
ultrabase-deploy rollback        # Rollback para versão anterior
ultrabase-deploy list-backups    # Listar backups disponíveis
```

### Migrações
```bash
ultrabase-migrate create "nome"     # Criar migração
ultrabase-migrate apply ID         # Aplicar migração
ultrabase-migrate rollback ID      # Reverter migração
ultrabase-migrate status           # Status das migrações
```

### Monitoramento
```bash
ultrabase-monitor status           # Status do sistema
ultrabase-monitor install-cron 300 # Monitoramento a cada 5min
ultrabase-monitor test-alerts      # Testar alertas
ultrabase-monitor logs             # Ver logs
```

### Preservação de Dados
```bash
ultrabase-preserve status          # Status da preservação
ultrabase-preserve verify          # Verificar integridade
ultrabase-preserve restore         # Restaurar dados
```

## 🔧 Configuração Avançada

### Alertas Discord
1. Criar webhook no Discord
2. Editar configuração: `ultrabase-monitor edit-config`
3. Testar: `ultrabase-monitor test-alerts`

### Monitoramento Automático
```bash
# Configurar verificação a cada 5 minutos
ultrabase-monitor install-cron 300
```

### GitHub Actions
O sistema inclui GitHub Actions que fazem deploy automático quando você faz push para `main`, com:
- Backup automático antes do deploy
- Preservação de dados existentes
- Rollback automático em caso de falha
- Testes pós-deploy

## 📊 Benefícios vs Deploy Tradicional

| Aspecto | Antes | Depois |
|---------|--------|--------|
| **Deploy** | Perdia tudo | Preserva tudo |
| **Problemas** | Manual | Auto-recovery |
| **Rollback** | Impossível | Instantâneo |
| **Monitoramento** | Nenhum | 24/7 com alertas |
| **Segurança** | Arriscado | Múltiplos backups |
| **Confiança** | Baixa | Altíssima |

## 📚 Documentação

- **[SISTEMA_VERSIONAMENTO.md](SISTEMA_VERSIONAMENTO.md)** - Documentação completa do sistema de versionamento
- **[DEPLOY_GUIDE.md](DEPLOY_GUIDE.md)** - Guia de deploy tradicional
- **ULTRABASE_SETUP_COMPLETO.md** - Guia personalizado (gerado após setup)

## 🚨 Resolução de Problemas

### Deploy Falhou
```bash
ultrabase-deploy rollback
```

### Sistema Instável
```bash
ultrabase-monitor status
ultrabase-deploy verify
```

### Dados Perdidos
```bash
ultrabase-preserve restore
```

### Logs e Debug
```bash
ultrabase-monitor logs 100
ultrabase-migrate status
```

## 🎉 Funcionalidades Principais

### ✅ Criação de Projetos
- Nome personalizado
- Organização opcional
- Configuração automática de portas
- Isolamento completo entre projetos

### ✅ Gerenciamento de Recursos
- Iniciar/Parar projetos
- Monitoramento de status
- Logs detalhados por projeto
- Remoção segura de projetos

### ✅ Segurança e Backup
- Backup automático antes de cada deploy
- Preservação de dados entre deploys
- Rollback para qualquer versão anterior
- Monitoramento contínuo com alertas

### ✅ Monitoramento
- Dashboard de status em tempo real
- Alertas via Discord/Webhook
- Auto-recovery automático
- Logs estruturados e pesquisáveis

## 🛠️ Tecnologias Utilizadas

- **Frontend**: HTML5, CSS3, JavaScript (Vanilla)
- **Backend**: Node.js, Express
- **Containerização**: Docker, Docker Compose
- **Banco de Dados**: PostgreSQL (uma instância por projeto)
- **Processo Manager**: PM2
- **Proxy**: Nginx
- **Gateway**: Kong
- **Monitoramento**: Scripts Bash + Cron
- **CI/CD**: GitHub Actions

## 📈 Roadmap

- [x] Sistema básico de gerenciamento
- [x] Deploy automático via GitHub Actions
- [x] **Sistema de versionamento completo**
- [x] **Backup automático e rollback**
- [x] **Monitoramento 24/7 com alertas**
- [x] **Auto-recovery automático**
- [ ] Interface de monitoramento web
- [ ] Integração com serviços de backup externos
- [ ] Métricas avançadas e dashboards
- [ ] API para automação externa

## 🤝 Contribuição

1. Fork o projeto
2. Crie uma branch para sua feature (`git checkout -b feature/AmazingFeature`)
3. Commit suas mudanças (`git commit -m 'Add some AmazingFeature'`)
4. Push para a branch (`git push origin feature/AmazingFeature`)
5. Abra um Pull Request

## 📝 Licença

Este projeto está sob a licença MIT. Veja o arquivo [LICENSE](LICENSE) para mais detalhes.

## 🙏 Agradecimentos

- [Supabase](https://supabase.com) - Pela inspiração e tecnologia base
- [Docker](https://docker.com) - Containerização
- [Kong](https://konghq.com) - API Gateway
- [PostgreSQL](https://postgresql.org) - Banco de dados

---

**🎯 Acesse agora: [http://82.25.69.57](http://82.25.69.57)**

**📞 Suporte**: Consulte os logs detalhados ou faça rollback se necessário!