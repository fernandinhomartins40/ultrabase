# Documentação da Integração com Cursor - Ultrabase

## Visão Geral

A funcionalidade "Integração com Cursor" é um modal interativo que fornece aos desenvolvedores tudo o que precisam para integrar rapidamente uma instância Supabase em seus projetos de desenvolvimento no Cursor ou qualquer IDE/editor de código.

## Estrutura da Funcionalidade

### 1. Modal Principal
- **ID**: `cursor-integration-modal`
- **Trigger**: Botão "Integração com Cursor" em cada card de projeto
- **Função de abertura**: `showCursorIntegration(projectId, projectName)`

### 2. Sistema de Tabs

A interface é organizada em 3 tabs principais:

#### Tab 1: Setup Rápido (`quick-setup`)
**Propósito**: Fornecer um fluxo simplificado para integração rápida

**Seções**:
1. **Arquivo .env Pronto**
   - Mostra o conteúdo completo do arquivo .env
   - Botão para copiar o conteúdo
   - Formatação com highlight de código

2. **Instalar Supabase Client**
   - Tabs para diferentes gerenciadores de pacote (npm, yarn, pnpm)
   - Comandos de instalação dinâmicos
   - Função: `showCommand(type)`

3. **Código de Inicialização**
   - Tabs para diferentes frameworks (JavaScript, TypeScript, React, Next.js)
   - Código específico para cada framework
   - Função: `showFramework(framework)`
   - Busca código via API: `/api/framework-code/${framework}`

4. **Testar Conexão**
   - Botões para testar conectividade
   - Funções: `testConnection(projectId)`, `runQuickTest(projectId)`
   - Resultados exibidos em `test-results`

#### Tab 2: Configuração Manual (`manual-config`)
**Propósito**: Fornecer acesso detalhado a todas as credenciais e configurações

**Seções**:
1. **URLs e Endpoints**
   - Supabase URL
   - API URL
   - Botões de cópia individuais

2. **Chaves de API**
   - Anon Key (para frontend)
   - Service Key (para backend)
   - Campos readonly com botões de cópia

3. **Database Connection**
   - String de conexão do PostgreSQL
   - Formatação para fácil visualização

#### Tab 3: Automação (`automation`)
**Propósito**: Permitir execução de comandos SQL e ações automatizadas

**Seções**:
1. **Executar SQL via API**
   - Textarea para comandos SQL
   - Função: `executeSql(projectId)`
   - Templates pré-definidos via `loadSqlTemplates()`
   - Resultados em `sql-results`

2. **Ações Rápidas**
   - `createUsersTable()`: Cria tabela de usuários
   - `enableRLS()`: Ativa Row Level Security
   - `createAuthTriggers()`: Cria triggers de autenticação
   - `createApiDocs()`: Gera documentação da API

## Funções JavaScript Principais

### Função Principal
```javascript
async function showCursorIntegration(projectId, projectName)
```
- Abre o modal
- Faz chamada para `/api/instances/${projectId}/cursor-config`
- Renderiza o conteúdo via `renderCursorIntegration(config, projectName)`

### Funções de Navegação
```javascript
function showTab(tabName)
function showCommand(type)
function showFramework(framework)
```

### Funções de Teste
```javascript
async function testConnection(projectId)
async function runQuickTest(projectId)
```

### Funções de Automação
```javascript
async function executeSql(projectId)
async function createUsersTable(projectId)
async function enableRLS(projectId)
async function createAuthTriggers(projectId)
function loadSqlTemplates()
```

### Função de Fechamento
```javascript
function closeCursorIntegrationModal()
```

## APIs Backend Necessárias

Para que a funcionalidade funcione completamente, o backend deve implementar:

1. **GET** `/api/instances/{projectId}/cursor-config`
   - Retorna todas as configurações necessárias
   - Estrutura esperada:
   ```json
   {
     "project_id": "string",
     "supabase_url": "string",
     "api_url": "string",
     "anon_key": "string",
     "service_role_key": "string",
     "database_url": "string",
     "env_content": "string",
     "frameworks": {
       "javascript": "string",
       "typescript": "string",
       "react": "string",
       "nextjs": "string"
     }
   }
   ```

2. **GET** `/api/framework-code/{framework}`
   - Retorna código específico do framework
   - Estrutura: `{ "code": "string" }`

3. **POST** `/api/instances/{projectId}/test-connection`
   - Testa conectividade da instância
   - Retorna: `{ "message": "string", "status": "success|error" }`

4. **POST** `/api/instances/{projectId}/execute-sql`
   - Executa comandos SQL
   - Body: `{ "query": "string" }`
   - Retorna: `{ "result": "object", "message": "string" }`

## Estilos CSS

A funcionalidade utiliza classes CSS específicas:
- `.cursor-integration-tabs`
- `.tab-buttons`, `.tab-btn`
- `.tab-content`
- `.setup-section`
- `.credentials-section`
- `.automation-section`
- `.code-block`
- `.command-tabs`, `.cmd-tab`
- `.framework-tabs`, `.fw-tab`
- `.sql-executor`
- `.quick-actions`

## Dependências

- **Lucide Icons**: Para todos os ícones da interface
- **Fetch API**: Para chamadas assíncronas ao backend
- **Clipboard API**: Para funcionalidade de cópia (com fallback)

## Fluxo de Uso Típico

1. Usuário clica em "Integração com Cursor" em um card de projeto
2. Modal abre e carrega as configurações do backend
3. Usuário navega pelas tabs conforme sua necessidade:
   - **Setup Rápido**: Para integração imediata
   - **Config Manual**: Para configuração detalhada
   - **Automação**: Para tarefas administrativas
4. Usuário copia credenciais/código necessário
5. Usuário testa a conexão (opcional)
6. Usuário fecha o modal

## Tratamento de Erros

- Todas as funções assíncronas têm try-catch
- Mensagens de erro são exibidas via `showAlert()`
- Loading states são mostrados durante operações
- Fallbacks são implementados quando necessário

## Acessibilidade

- Navegação por teclado nas tabs
- Labels descritivos nos botões
- Contraste adequado nos elementos
- Texto alternativo nos ícones