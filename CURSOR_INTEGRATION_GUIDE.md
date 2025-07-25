# 🚀 Guia de Integração com Cursor - Ultrabase

## 🎯 **Visão Geral**

A nova integração com Cursor torna **extremamente simples** conectar seus projetos às instâncias Supabase criadas no Ultrabase. Tudo foi pensado para ser **copy & paste**, perfeito para pessoas leigas e desenvolvedores experientes.

---

## 🌟 **Funcionalidades Principais**

### ✅ **Para Pessoas Leigas:**
- **Botão "Integrar Cursor"** nos cards das instâncias
- **Arquivo .env pronto** para copy/paste
- **Código de inicialização** gerado automaticamente
- **Instruções passo-a-passo** visuais

### ✅ **Para Desenvolvedores:**
- **Templates específicos** para cada framework
- **API de automação** para configuração via código
- **Execução de SQL** direto da interface
- **Testes de conectividade** integrados

---

## 🚀 **Como Usar - Passo a Passo**

### **1. Acessar a Integração**
1. Acesse seu dashboard: http://82.25.69.57
2. Encontre sua instância na lista
3. Clique no botão **"Integrar Cursor"** (azul com ícone de código)

### **2. Escolher a Aba Ideal**

#### **🔥 Setup Rápido (Recomendado para Iniciantes)**
- **Arquivo .env completo** → Copy direto para seu projeto
- **Comando de instalação** → npm/yarn/pnpm
- **Código pronto** → JavaScript, TypeScript, React, Next.js
- **Teste de conexão** → Validar se está funcionando

#### **⚙️ Config Manual (Para Desenvolvedores)**
- **URLs organizadas** → API, Dashboard, Database
- **Chaves individuais** → Anon Key, Service Role, JWT Secret
- **Copy individual** → Cada credencial separadamente

#### **🤖 Automação (Para Configuração Avançada)**
- **Executor SQL** → Rodar comandos direto na interface
- **Ações rápidas** → Criar tabelas, RLS, triggers
- **API REST** → Automatizar via código

---

## 📝 **Exemplo Prático - Projeto Next.js**

### **Passo 1: Copy do .env**
```bash
# No modal "Setup Rápido", copiar o arquivo .env
# Cole no seu projeto como .env.local
```

### **Passo 2: Instalar Supabase**
```bash
npm install @supabase/supabase-js
```

### **Passo 3: Código de Inicialização**
```javascript
// lib/supabase.js - Copy do modal
import { createClient } from '@supabase/supabase-js'

export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)
```

### **Passo 4: Testar Conexão**
- Clicar em **"Testar Conexão"** no modal
- Verificar se aparece ✅ "Conexão bem-sucedida!"

---

## 🛠️ **Automação Avançada**

### **Criar Tabela Users via Interface**
1. Ir na aba **"Automação"**
2. Clicar em **"Criar Tabela Users"**
3. Será executado automaticamente com RLS e triggers

### **Executar SQL Personalizado**
1. Digitar SQL no editor integrado
2. Clicar **"Executar SQL"**
3. Ver resultados em tempo real

### **Ações Rápidas Disponíveis**
- **👥 Criar Tabela Users** → Com RLS e triggers automáticos
- **🛡️ Ativar RLS** → Row Level Security
- **🔗 Auth Triggers** → Sincronização de usuários
- **📚 API Docs** → Documentação automática

---

## 🔧 **API de Automação**

### **Executar SQL via REST**
```javascript
const response = await fetch('http://82.25.69.57:3080/api/instances/{ID}/execute-sql', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer YOUR_TOKEN'
  },
  body: JSON.stringify({ 
    query: 'CREATE TABLE posts (id uuid PRIMARY KEY, title text)' 
  })
})
```

### **Testar Conexão Programaticamente**
```javascript
const test = await fetch('http://82.25.69.57:3080/api/instances/{ID}/test-connection')
const result = await test.json()
console.log(result.message) // "API responding on port XXXX"
```

---

## 📋 **Templates Disponíveis**

### **Frameworks Suportados:**
- ✅ **JavaScript Vanilla**
- ✅ **TypeScript**
- ✅ **React**
- ✅ **Next.js**
- ✅ **Vue.js** (próxima versão)
- ✅ **Nuxt.js** (próxima versão)

### **Gerenciadores de Pacotes:**
- ✅ **npm**
- ✅ **yarn**
- ✅ **pnpm**

---

## 🎯 **Casos de Uso Comuns**

### **1. Projeto Pessoal Simples**
- Usar **"Setup Rápido"**
- Copy .env + código inicialização
- Testar conexão
- ✅ **Pronto em 2 minutos!**

### **2. Projeto Profissional**
- Usar **"Config Manual"**
- Configurar chaves específicas
- Implementar autenticação robusta
- ✅ **Controle total das credenciais**

### **3. Configuração Automatizada**
- Usar aba **"Automação"**
- Criar estrutura via SQL
- Configurar RLS e policies
- ✅ **Setup completo automatizado**

### **4. Integração CI/CD**
- Usar **API REST endpoints**
- Automatizar setup via scripts
- Deploy com configuração dinâmica
- ✅ **DevOps profissional**

---

## 🚨 **Dicas Importantes**

### **🔑 Segurança:**
- **Anon Key** → Frontend (público)
- **Service Role Key** → Backend (privado)
- **JWT Secret** → Apenas configuração

### **📱 URLs:**
- **Dashboard:** http://82.25.69.57:PORTA
- **API:** http://82.25.69.57:PORTA/rest/v1
- **Database:** postgresql://postgres:SENHA@82.25.69.57:PORTA/postgres

### **⚡ Performance:**
- Cada instância tem **portas únicas**
- **Isolamento completo** entre projetos
- **Backup automático** dos dados

---

## 🎉 **Resultado Final**

### **✅ Para Pessoas Leigas:**
1. **Clicar** no botão "Integrar Cursor"
2. **Copiar** o arquivo .env
3. **Colar** no projeto
4. **Funciona!** 🚀

### **✅ Para Desenvolvedores:**
1. **Configuração completa** em minutos
2. **Automação via API** disponível
3. **Templates específicos** para cada stack
4. **Controle total** das credenciais

### **✅ Para DevOps:**
1. **API endpoints** para automação
2. **Integração CI/CD** nativa
3. **Monitoramento** de conectividade
4. **Backup versionado** automático

---

## 🆘 **Suporte**

### **Como Testar:**
1. Criar uma instância em: http://82.25.69.57
2. Clicar "Integrar Cursor"
3. Seguir o guia "Setup Rápido"
4. Testar conexão

### **Se der Problema:**
- ✅ Verificar se instância está **"running"**
- ✅ Testar conexão no próprio modal
- ✅ Verificar se .env está correto
- ✅ Confirmar porta na URL

### **Onde Buscar Ajuda:**
- **Logs da aplicação:** pm2 logs supabase-manager
- **GitHub Issues:** https://github.com/fernandinhomartins40/ultrabase/issues
- **Deploy Status:** https://github.com/fernandinhomartins40/ultrabase/actions

---

**Status:** ✅ **Integração funcionando perfeitamente**  
**Deploy:** ✅ **Automático via GitHub Actions**  
**Versão:** v1.1.0-cursor-integration  
**Dashboard:** http://82.25.69.57 