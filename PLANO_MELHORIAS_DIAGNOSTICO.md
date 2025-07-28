# Plano de Melhorias para Diagnóstico e Controle do Gerenciador de Instâncias

## Análise Atual do Sistema

### Componentes Identificados

#### 1. **Gerenciador de Instâncias (SupabaseInstanceManager)**
- **Localização**: `src/server.js:311-1210`
- **Funcionalidade**: Controla criação, inicialização, parada e remoção de instâncias
- **Pontos Críticos**: 
  - Método `createInstance()` com timeout de 10 minutos
  - Execução do script `generate-adapted.bash` para criação
  - Status básico: 'creating', 'running', 'stopped', 'error'

#### 2. **Componente GoTrue (Autenticação)**
- **Localização**: Container `supabase-auth-${INSTANCE_ID}` no docker-compose
- **Imagem**: `supabase/gotrue:v2.167.0`
- **Configuração**: Via variáveis de ambiente no `.env-${INSTANCE_ID}`
- **Problema Relatado**: "Failed to create user: API error happened while trying to communicate with the server"

#### 3. **Sistema de Logs Atual**
- **Vector Logging**: `supabase-core/volumes/logs/vector.yml`
- **Coleta**: Logs de todos os containers via Docker
- **Destino**: Logflare Analytics (`http://analytics:4000`)
- **Limitação**: Logs não são facilmente acessíveis para diagnóstico

#### 4. **Monitoramento Básico**
- **Health Checks**: Implementados nos containers Docker
- **Status Verification**: Método `getInstanceStatus()` verifica containers
- **Limitação**: Apenas verifica se containers estão rodando

---

## Fases de Implementação

### **FASE 1: Sistema de Diagnóstico Sob Demanda** 
*Prioridade: ALTA | Duração: 3-5 dias*

#### Objetivo
Implementar ferramentas completas de diagnóstico que executam sob demanda (manual ou agendado) para identificar problemas em instâncias.

#### Implementações Técnicas

##### 1.1 Health Check Detalhado (Sob Demanda)
```javascript
// Nova classe para diagnóstico sob demanda
class InstanceDiagnostics {
  constructor() {
    this.lastDiagnosticCache = new Map(); // Cache para evitar execuções desnecessárias
  }

  async runFullDiagnostic(instanceId) {
    console.log(`🔍 Iniciando diagnóstico sob demanda para instância ${instanceId}`);
    
    const diagnostic = {
      timestamp: new Date().toISOString(),
      instance_id: instanceId,
      results: {
        container_status: await this.checkContainers(instanceId),
        service_health: await this.checkServices(instanceId),
        database_connection: await this.checkDatabase(instanceId),
        api_endpoints: await this.checkAPIEndpoints(instanceId),
        auth_service: await this.checkAuthService(instanceId),
        disk_usage: await this.checkDiskUsage(instanceId),
        network_connectivity: await this.checkNetworkConnectivity(instanceId)
      }
    };

    // Cache do último diagnóstico (válido por 5 minutos)
    this.lastDiagnosticCache.set(instanceId, {
      data: diagnostic,
      expires: Date.now() + (5 * 60 * 1000)
    });

    return diagnostic;
  }

  async getLastDiagnostic(instanceId) {
    const cached = this.lastDiagnosticCache.get(instanceId);
    if (cached && cached.expires > Date.now()) {
      return cached.data;
    }
    return null;
  }

  // Diagnóstico rápido para uso após operações de reparo
  async quickHealthCheck(instanceId) {
    return {
      timestamp: new Date().toISOString(),
      healthy: await this.isInstanceHealthy(instanceId),
      critical_services: await this.checkCriticalServices(instanceId)
    };
  }
}
```

##### 1.2 Endpoints de Diagnóstico Sob Demanda
```javascript
// Endpoint principal para executar diagnóstico manual
app.get('/api/instances/:id/run-diagnostics', authenticateToken, checkProjectAccess, async (req, res) => {
  try {
    console.log(`🔍 Usuário ${req.user.id} executando diagnóstico para instância ${req.params.id}`);
    
    const diagnostic = await instanceDiagnostics.runFullDiagnostic(req.params.id);
    
    res.json({
      success: true,
      message: 'Diagnóstico executado com sucesso',
      diagnostic: diagnostic
    });
  } catch (error) {
    console.error('❌ Erro no diagnóstico:', error);
    res.status(500).json({ error: error.message });
  }
});

// Endpoint para obter último diagnóstico (sem executar novo)
app.get('/api/instances/:id/last-diagnostic', authenticateToken, checkProjectAccess, async (req, res) => {
  try {
    const lastDiagnostic = await instanceDiagnostics.getLastDiagnostic(req.params.id);
    
    if (!lastDiagnostic) {
      return res.json({
        success: false,
        message: 'Nenhum diagnóstico recente. Execute um novo diagnóstico.',
        run_diagnostic_url: `/api/instances/${req.params.id}/run-diagnostics`
      });
    }
    
    res.json({
      success: true,
      diagnostic: lastDiagnostic
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Endpoint para diagnóstico de todas as instâncias (uso em cron)
app.get('/api/instances/check-all-health', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const instances = Object.keys(manager.instances);
    const results = [];
    
    for (const instanceId of instances) {
      const diagnostic = await instanceDiagnostics.runFullDiagnostic(instanceId);
      results.push({
        instance_id: instanceId,
        instance_name: manager.instances[instanceId].name,
        healthy: diagnostic.results.service_health.overall_healthy,
        issues: diagnostic.results.service_health.issues || []
      });
    }
    
    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      total_instances: instances.length,
      results: results
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
```

##### 1.3 Sistema de Logs Estruturados (Sob Demanda)
```javascript
// Endpoint para análise de logs sob demanda
app.get('/api/instances/:id/diagnostic-logs', authenticateToken, checkProjectAccess, async (req, res) => {
  try {
    const logs = await LogAnalyzer.getStructuredLogs(req.params.id, {
      services: req.query.services ? req.query.services.split(',') : ['auth', 'rest', 'db', 'kong'],
      level: req.query.level || 'error',
      timeRange: req.query.range || '1h'
    });
    
    res.json({
      success: true,
      logs: logs,
      summary: {
        total_entries: logs.length,
        error_count: logs.filter(log => log.level === 'error').length,
        warning_count: logs.filter(log => log.level === 'warning').length
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
```

##### 1.4 Agendamento Opcional via Cron
```bash
# Exemplo de configuração cron para verificação a cada 6 horas
# Adicionar ao crontab do sistema (opcional)

# Diagnóstico geral de todas as instâncias a cada 6h
0 */6 * * * curl -H "Authorization: Bearer YOUR_ADMIN_TOKEN" http://localhost:3080/api/instances/check-all-health > /var/log/ultrabase-health.log 2>&1

# Diagnóstico de instância específica se necessário
0 */6 * * * curl -H "Authorization: Bearer YOUR_TOKEN" http://localhost:3080/api/instances/INSTANCE_ID/run-diagnostics > /var/log/ultrabase-instance-health.log 2>&1
```

#### Arquivos Modificados
- `src/server.js`: Adicionar classe `InstanceDiagnostics`
- Novo arquivo: `src/diagnostics/health-checker.js`
- Novo arquivo: `src/diagnostics/log-analyzer.js`

#### Riscos e Mitigações
- **Risco**: Sobrecarga do sistema com muitas verificações simultâneas
- **Mitigação**: Cache de resultados por 5 minutos, execução sob demanda apenas
- **Risco**: Timeouts em verificações de rede
- **Mitigação**: Timeouts configuráveis (padrão 5s), execução assíncrona
- **Risco**: Usuários executando diagnósticos desnecessários
- **Mitigação**: Rate limiting (1 diagnóstico por instância a cada 2 minutos)

---

### **FASE 2: Sistema de Controle e Gestão**
*Prioridade: ALTA*

#### Objetivo
Implementar controles seguros para gerenciar instâncias sem perda de dados.

#### Implementações Técnicas

##### 2.1 Operações Seguras de Controle
```javascript
class SafeInstanceManager extends SupabaseInstanceManager {
  async safeRestart(instanceId) {
    // 1. Backup automático de configurações
    await this.backupInstanceConfig(instanceId);
    
    // 2. Verificação de estado antes da parada
    const preStopState = await this.captureInstanceState(instanceId);
    
    // 3. Parada graceful com timeout
    await this.gracefulStop(instanceId, 30000);
    
    // 4. Verificação de integridade dos volumes
    await this.verifyVolumeIntegrity(instanceId);
    
    // 5. Restart com verificação de saúde
    await this.startWithHealthCheck(instanceId);
    
    // 6. Verificação pós-restart
    return await this.verifyPostRestartState(instanceId, preStopState);
  }
  
  async repairInstance(instanceId) {
    const issues = await this.diagnostics.identifyIssues(instanceId);
    const repairActions = await this.planRepairActions(issues);
    
    for (const action of repairActions) {
      await this.executeRepairAction(instanceId, action);
      await this.verifyRepairResult(instanceId, action);
    }
  }
}
```

##### 2.2 Editor de Configurações Seguro
```javascript
// Endpoint para edição segura de configurações
app.put('/api/instances/:id/config', authenticateToken, checkProjectAccess, async (req, res) => {
  const { field, value } = req.body;
  
  // Validação de campos permitidos
  const allowedFields = ['name', 'dashboard_username', 'dashboard_password'];
  if (!allowedFields.includes(field)) {
    return res.status(400).json({ error: 'Campo não editável' });
  }
  
  // Backup da configuração atual
  await instanceManager.backupInstanceConfig(req.params.id);
  
  // Aplicação da mudança
  const result = await instanceManager.updateInstanceConfig(req.params.id, field, value);
  
  // Verificação se a instância ainda funciona
  const healthCheck = await instanceManager.diagnostics.quickHealthCheck(req.params.id);
  
  if (!healthCheck.healthy) {
    // Rollback automático
    await instanceManager.rollbackInstanceConfig(req.params.id);
    return res.status(500).json({ error: 'Mudança causou problemas, rollback executado' });
  }
  
  res.json(result);
});
```

##### 2.3 Sistema de Backup e Rollback
- **Backup Automático**: Antes de qualquer operação crítica
- **Snapshot de Estado**: Captura estado completo da instância
- **Rollback Seguro**: Restauração automática em caso de falha

#### Arquivos Modificados
- `src/server.js`: Extensão da classe principal
- Novo arquivo: `src/management/safe-manager.js`
- Novo arquivo: `src/management/config-editor.js`
- Novo arquivo: `src/management/backup-system.js`

#### Riscos e Mitigações
- **Risco**: Corrupção durante backup/rollback
- **Mitigação**: Verificação de integridade, backups múltiplos
- **Risco**: Perda de dados durante restart
- **Mitigação**: Verificação de volume, parada graceful

---

### **FASE 3: Dashboard de Monitoramento**
*Prioridade: MÉDIA*

#### Objetivo
Interface visual para monitoramento e controle das instâncias.

#### Implementações Técnicas

##### 3.1 Dashboard de Diagnóstico Sob Demanda
```html
<!-- Adição ao index.html - Seção de diagnóstico por instância -->
<div class="instance-card" data-instance="${instanceId}">
  <div class="instance-header">
    <h3>${instanceName}</h3>
    <span class="instance-status ${status}">${status}</span>
  </div>
  
  <!-- Controles de Diagnóstico -->
  <div class="diagnostic-controls">
    <button class="btn-primary run-diagnostic-btn" 
            onclick="controlPanel.runDiagnostics('${instanceId}')">
      🔍 Executar Diagnóstico Agora
    </button>
    
    <button class="btn-secondary" 
            onclick="controlPanel.showLastDiagnostic('${instanceId}')">
      📊 Ver Último Diagnóstico
    </button>
    
    <button class="btn-tertiary" 
            onclick="controlPanel.showDiagnosticHistory('${instanceId}')">
      📈 Histórico
    </button>
  </div>
  
  <!-- Área de Resultados (carregada sob demanda) -->
  <div class="diagnostic-results" style="display: none;">
    <!-- Resultados serão carregados aqui dinamicamente -->
  </div>
  
  <!-- Controles de Ação -->
  <div class="action-controls" style="display: none;">
    <button class="btn-warning" 
            onclick="controlPanel.safeRestart('${instanceId}')">
      🔄 Restart Seguro
    </button>
    
    <button class="btn-info" 
            onclick="controlPanel.showLogs('${instanceId}')">
      📝 Ver Logs
    </button>
  </div>
</div>
```

##### 3.2 Controle de Instâncias com Diagnóstico Sob Demanda
```javascript
// JavaScript para interface de controle
class InstanceControlPanel {
  constructor() {
    this.diagnosticInProgress = new Set(); // Evitar múltiplas execuções
  }

  async runDiagnostics(instanceId) {
    if (this.diagnosticInProgress.has(instanceId)) {
      this.showWarning('Diagnóstico já em execução para esta instância');
      return;
    }

    const diagnosticButton = document.querySelector(`[data-instance="${instanceId}"] .run-diagnostic-btn`);
    diagnosticButton.disabled = true;
    diagnosticButton.textContent = 'Executando...';
    
    this.diagnosticInProgress.add(instanceId);

    try {
      const response = await fetch(`/api/instances/${instanceId}/run-diagnostics`);
      const data = await response.json();
      
      if (data.success) {
        this.renderDiagnosticResults(instanceId, data.diagnostic);
        this.showSuccess('Diagnóstico executado com sucesso');
      } else {
        this.showError('Falha no diagnóstico');
      }
    } catch (error) {
      this.showError(`Erro no diagnóstico: ${error.message}`);
    } finally {
      this.diagnosticInProgress.delete(instanceId);
      diagnosticButton.disabled = false;
      diagnosticButton.textContent = 'Executar Diagnóstico Agora';
    }
  }

  async showLastDiagnostic(instanceId) {
    try {
      const response = await fetch(`/api/instances/${instanceId}/last-diagnostic`);
      const data = await response.json();
      
      if (data.success && data.diagnostic) {
        this.renderDiagnosticResults(instanceId, data.diagnostic);
      } else {
        this.showInfo('Nenhum diagnóstico recente. Execute um novo diagnóstico.');
      }
    } catch (error) {
      this.showError(`Erro ao carregar diagnóstico: ${error.message}`);
    }
  }

  renderDiagnosticResults(instanceId, diagnostic) {
    const resultsContainer = document.querySelector(`[data-instance="${instanceId}"] .diagnostic-results`);
    const timestamp = new Date(diagnostic.timestamp).toLocaleString('pt-BR');
    
    let html = `
      <div class="diagnostic-header">
        <h4>Diagnóstico - ${timestamp}</h4>
        <button class="btn-secondary" onclick="controlPanel.showLastDiagnostic('${instanceId}')">
          Atualizar Resultados
        </button>
      </div>
      <div class="health-cards">
    `;

    // Renderizar cards de saúde
    Object.entries(diagnostic.results).forEach(([service, result]) => {
      const status = result.healthy ? 'healthy' : 'unhealthy';
      const icon = result.healthy ? '✅' : '❌';
      
      html += `
        <div class="health-card ${status}">
          <div class="service-name">${icon} ${service.replace('_', ' ').toUpperCase()}</div>
          <div class="service-status">${result.status || 'N/A'}</div>
          ${result.issues ? `<div class="issues">${result.issues.join(', ')}</div>` : ''}
        </div>
      `;
    });

    html += '</div>';
    resultsContainer.innerHTML = html;
  }
  
  async safeRestart(instanceId) {
    if (!confirm('Confirma restart seguro da instância?')) return;
    
    const progressModal = this.showProgressModal();
    
    try {
      const result = await fetch(`/api/instances/${instanceId}/safe-restart`, {
        method: 'POST'
      });
      
      if (result.ok) {
        this.showSuccess('Instância reiniciada com sucesso');
        // Executar diagnóstico após restart para verificar saúde
        setTimeout(() => this.runDiagnostics(instanceId), 2000);
      } else {
        this.showError('Falha no restart');
      }
    } finally {
      progressModal.close();
    }
  }
}

// Instância global
const controlPanel = new InstanceControlPanel();
```

#### Arquivos Modificados
- `src/public/index.html`: Adicionar seções de diagnóstico
- Novo arquivo: `src/public/js/diagnostics.js`
- Novo arquivo: `src/public/css/diagnostics.css`

---

### **FASE 4: Sistema de Relatórios e Histórico**
*Prioridade: BAIXA | Duração: 2-3 dias*

#### Objetivo
Sistema de relatórios históricos e análise de tendências baseado em diagnósticos executados.

#### Implementações Técnicas

##### 4.1 Histórico de Diagnósticos
```javascript
class DiagnosticHistory {
  constructor() {
    this.historyFile = path.join(__dirname, 'diagnostic-history.json');
    this.maxHistoryEntries = 100; // Por instância
  }
  
  async saveDiagnostic(instanceId, diagnostic) {
    const history = await this.loadHistory();
    
    if (!history[instanceId]) {
      history[instanceId] = [];
    }
    
    // Adicionar novo diagnóstico
    history[instanceId].unshift({
      ...diagnostic,
      id: uuidv4().substring(0, 8)
    });
    
    // Limitar histórico
    if (history[instanceId].length > this.maxHistoryEntries) {
      history[instanceId] = history[instanceId].slice(0, this.maxHistoryEntries);
    }
    
    await this.saveHistory(history);
  }
  
  async generateHealthReport(instanceId, days = 7) {
    const history = await this.loadHistory();
    const instanceHistory = history[instanceId] || [];
    
    const cutoffDate = new Date(Date.now() - (days * 24 * 60 * 60 * 1000));
    const recentDiagnostics = instanceHistory.filter(d => 
      new Date(d.timestamp) > cutoffDate
    );
    
    return {
      instance_id: instanceId,
      period_days: days,
      total_diagnostics: recentDiagnostics.length,
      health_trend: this.calculateHealthTrend(recentDiagnostics),
      most_common_issues: this.getMostCommonIssues(recentDiagnostics),
      uptime_percentage: this.calculateUptimePercentage(recentDiagnostics)
    };
  }
}
```

##### 4.2 Endpoints de Relatório
```javascript
// Endpoint para histórico de diagnósticos
app.get('/api/instances/:id/diagnostic-history', authenticateToken, checkProjectAccess, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const history = await diagnosticHistory.getInstanceHistory(req.params.id, limit);
    
    res.json({
      success: true,
      history: history
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Endpoint para relatório de saúde
app.get('/api/instances/:id/health-report', authenticateToken, checkProjectAccess, async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 7;
    const report = await diagnosticHistory.generateHealthReport(req.params.id, days);
    
    res.json({
      success: true,
      report: report
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
```

##### 4.3 Agendamento Opcional de Diagnósticos
```javascript
// Classe opcional para agendamento (sem execução automática)
class ScheduledDiagnostics {
  constructor() {
    this.schedules = new Map(); // Armazena configurações, não executa
  }
  
  // Criar configuração de agendamento (para uso com cron externo)
  createScheduleConfig(instanceId, interval = '6h') {
    const config = {
      instance_id: instanceId,
      interval: interval,
      command: `curl -H "Authorization: Bearer TOKEN" http://localhost:3080/api/instances/${instanceId}/run-diagnostics`,
      cron_expression: this.intervalToCron(interval),
      created_at: new Date().toISOString()
    };
    
    this.schedules.set(instanceId, config);
    return config;
  }
  
  intervalToCron(interval) {
    const intervalMap = {
      '1h': '0 * * * *',
      '6h': '0 */6 * * *',
      '12h': '0 */12 * * *',
      '24h': '0 0 * * *'
    };
    
    return intervalMap[interval] || '0 */6 * * *';
  }
  
  // Gerar script de cron para o usuário
  generateCronScript(instanceId) {
    const config = this.schedules.get(instanceId);
    if (!config) return null;
    
    return `# Diagnóstico automático para instância ${instanceId}
${config.cron_expression} ${config.command} >> /var/log/ultrabase-diagnostic-${instanceId}.log 2>&1`;
  }
}
```

##### 4.4 Interface de Configuração de Agendamento
```html
<!-- Adição ao dashboard para configurar agendamento -->
<div class="schedule-config">
  <h4>Agendamento de Diagnósticos (Opcional)</h4>
  <p>Configure diagnósticos automáticos via cron system:</p>
  
  <select id="diagnostic-interval">
    <option value="6h">A cada 6 horas</option>
    <option value="12h">A cada 12 horas</option>
    <option value="24h">Diariamente</option>
  </select>
  
  <button onclick="generateCronConfig(instanceId)">Gerar Configuração Cron</button>
  
  <div id="cron-output" class="code-block hidden">
    <!-- Script cron será exibido aqui -->
  </div>
</div>
```

---

## Cronograma de Implementação

| Fase | Duração | Dependências | Riscos |
|------|---------|--------------|--------|
| Fase 1 | 3-5 dias | Nenhuma | Baixo |
| Fase 2 | 4-6 dias | Fase 1 completa | Médio |
| Fase 3 | 3-4 dias | Fases 1-2 completas | Baixo |
| Fase 4 | 2-3 dias | Fases 1-3 completas | Baixo |
| **Total** | **12-18 dias** | | |

---

## Garantias de Segurança

### 1. **Preservação de Dados**
- ✅ Backup automático antes de qualquer operação crítica
- ✅ Verificação de integridade de volumes Docker
- ✅ Rollback automático em caso de falha
- ✅ Parada graceful com timeout configurável

### 2. **Operações Não Destrutivas**
- ✅ Diagnósticos são read-only
- ✅ Restart usa `docker compose restart` (preserva volumes)
- ✅ Configurações mantêm compatibilidade
- ✅ Logs de auditoria para todas as operações

### 3. **Validação Contínua**
- ✅ Health checks após cada operação
- ✅ Verificação de conectividade de serviços
- ✅ Teste de integridade de dados
- ✅ Monitoramento pós-operação

### 4. **Controle de Acesso**
- ✅ Operações críticas requerem autenticação
- ✅ Logs de auditoria de todas as ações
- ✅ Controle de permissões por usuário
- ✅ Rate limiting para operações sensíveis

---

## Estrutura de Arquivos Após Implementação

```
src/
├── server.js (modificado)
├── diagnostics/
│   ├── health-checker.js (novo)
│   ├── log-analyzer.js (novo)
│   ├── diagnostic-history.js (novo)
│   └── scheduled-diagnostics.js (novo)
├── management/
│   ├── safe-manager.js (novo)
│   ├── config-editor.js (novo)
│   ├── backup-system.js (novo)
│   └── repair-engine.js (novo)
└── public/
    ├── index.html (modificado - botões de diagnóstico)
    ├── js/
    │   ├── diagnostics.js (novo)
    │   └── instance-control.js (novo)
    └── css/
        └── diagnostics.css (novo)
```

---

## Resolução do Problema Específico

### "Failed to create user: API error happened while trying to communicate with the server"

#### Diagnóstico Automatizado
Com as melhorias implementadas, o sistema poderá automaticamente:

1. **Verificar Status do GoTrue**
   ```bash
   GET /api/instances/{id}/diagnostics/auth
   ```
   - Container status
   - Health endpoint response
   - Database connection
   - JWT configuration

2. **Analisar Logs Específicos**
   ```bash
   GET /api/instances/{id}/logs?service=auth&level=error&range=1h
   ```
   - Filtrar logs do GoTrue
   - Identificar padrões de erro
   - Correlacionar com outros serviços

3. **Teste de Conectividade**
   ```bash
   POST /api/instances/{id}/test/user-creation
   ```
   - Simular criação de usuário
   - Validar response
   - Identificar ponto de falha

#### Ações de Reparo Automatizadas
1. **Restart do Serviço Auth**: Se container não responde
2. **Verificação de Configuração**: JWT secrets, database URL
3. **Teste de Database**: Conectividade e permissões
4. **Regeneração de Tokens**: Se JWT inválido

---

## Conclusão

Este plano oferece uma solução completa para os problemas de diagnóstico e controle do gerenciador de instâncias, mantendo a máxima segurança e confiabilidade do sistema. A implementação será incremental, permitindo testes e validação a cada etapa.

### Benefícios Esperados
- 🎯 **Diagnóstico sob demanda** preciso e detalhado de problemas
- 🛡️ **Zero downtime** desnecessário com operações seguras
- 📊 **Visibilidade controlada** do estado das instâncias
- 🔧 **Reparo assistido** de problemas comuns
- 📈 **Preparação para produção** com controle total do usuário
- ⚡ **Performance otimizada** sem overhead de monitoramento contínuo
- 🎛️ **Controle total** sobre quando executar diagnósticos

### Próximos Passos
1. **Aprovação do plano** pelo usuário
2. **Implementação da Fase 1** (diagnóstico básico)
3. **Testes em ambiente de desenvolvimento**
4. **Implementação incremental das demais fases**
5. **Documentação final** e treinamento