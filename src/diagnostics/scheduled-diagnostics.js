const fs = require('fs').promises;
const path = require('path');

/**
 * Classe para gerenciar configurações de agendamento de diagnósticos
 * Não executa diagnósticos automaticamente - apenas gera configurações para cron externo
 */
class ScheduledDiagnostics {
  constructor() {
    this.schedulesFile = path.join(__dirname, 'diagnostic-schedules.json');
    this.schedules = new Map(); // Cache em memória
    this.loadSchedules();
  }

  /**
   * Carrega configurações de agendamento do arquivo
   */
  async loadSchedules() {
    try {
      const data = await fs.readFile(this.schedulesFile, 'utf8');
      const schedules = JSON.parse(data);
      
      // Carregar no cache em memória
      Object.entries(schedules).forEach(([instanceId, config]) => {
        this.schedules.set(instanceId, config);
      });
      
      console.log(`📅 ${this.schedules.size} configurações de agendamento carregadas`);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.error('❌ Erro ao carregar configurações de agendamento:', error);
      }
    }
  }

  /**
   * Salva configurações de agendamento no arquivo
   */
  async saveSchedules() {
    try {
      const schedulesObj = {};
      this.schedules.forEach((config, instanceId) => {
        schedulesObj[instanceId] = config;
      });
      
      await fs.writeFile(this.schedulesFile, JSON.stringify(schedulesObj, null, 2));
    } catch (error) {
      console.error('❌ Erro ao salvar configurações de agendamento:', error);
      throw error;
    }
  }

  /**
   * Criar configuração de agendamento para uma instância
   */
  async createScheduleConfig(instanceId, options = {}) {
    const {
      interval = '6h',
      enabled = true,
      description = 'Diagnóstico automático agendado',
      notify_on_failure = false,
      max_retries = 2
    } = options;

    const config = {
      instance_id: instanceId,
      interval: interval,
      enabled: enabled,
      description: description,
      notify_on_failure: notify_on_failure,
      max_retries: max_retries,
      command: `curl -H "Authorization: Bearer TOKEN" http://localhost:3080/api/instances/${instanceId}/run-diagnostics`,
      cron_expression: this.intervalToCron(interval),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      last_execution: null,
      execution_count: 0
    };

    this.schedules.set(instanceId, config);
    await this.saveSchedules();

    console.log(`📅 Configuração de agendamento criada para instância ${instanceId} (${interval})`);
    return config;
  }

  /**
   * Atualizar configuração de agendamento existente
   */
  async updateScheduleConfig(instanceId, updates) {
    const existing = this.schedules.get(instanceId);
    if (!existing) {
      throw new Error(`Configuração de agendamento não encontrada para instância ${instanceId}`);
    }

    const updatedConfig = {
      ...existing,
      ...updates,
      updated_at: new Date().toISOString()
    };

    // Recriar expressão cron se o interval foi alterado
    if (updates.interval) {
      updatedConfig.cron_expression = this.intervalToCron(updates.interval);
    }

    // Atualizar comando se necessário
    if (updates.interval || !updatedConfig.command.includes(instanceId)) {
      updatedConfig.command = `curl -H "Authorization: Bearer TOKEN" http://localhost:3080/api/instances/${instanceId}/run-diagnostics`;
    }

    this.schedules.set(instanceId, updatedConfig);
    await this.saveSchedules();

    console.log(`📅 Configuração de agendamento atualizada para instância ${instanceId}`);
    return updatedConfig;
  }

  /**
   * Remover configuração de agendamento
   */
  async removeScheduleConfig(instanceId) {
    const existed = this.schedules.has(instanceId);
    this.schedules.delete(instanceId);
    
    if (existed) {
      await this.saveSchedules();
      console.log(`📅 Configuração de agendamento removida para instância ${instanceId}`);
    }
    
    return existed;
  }

  /**
   * Obter configuração de agendamento de uma instância
   */
  getScheduleConfig(instanceId) {
    return this.schedules.get(instanceId) || null;
  }

  /**
   * Listar todas as configurações de agendamento
   */
  getAllScheduleConfigs() {
    return Array.from(this.schedules.entries()).map(([instanceId, config]) => ({
      instance_id: instanceId,
      ...config
    }));
  }

  /**
   * Converter interval para expressão cron
   */
  intervalToCron(interval) {
    const intervalMap = {
      '15m': '*/15 * * * *',
      '30m': '*/30 * * * *',
      '1h': '0 * * * *',
      '2h': '0 */2 * * *',
      '4h': '0 */4 * * *',
      '6h': '0 */6 * * *',
      '8h': '0 */8 * * *',
      '12h': '0 */12 * * *',
      '24h': '0 0 * * *',
      'daily': '0 0 * * *',
      'weekly': '0 0 * * 0'
    };

    return intervalMap[interval] || '0 */6 * * *'; // Padrão: a cada 6 horas
  }

  /**
   * Gerar script de cron para uma instância específica
   */
  generateCronScript(instanceId, authToken = 'YOUR_TOKEN_HERE') {
    const config = this.schedules.get(instanceId);
    if (!config) {
      return null;
    }

    const logFile = `/var/log/ultrabase-diagnostic-${instanceId}.log`;
    const command = config.command.replace('TOKEN', authToken);

    return `# Diagnóstico automático para instância ${instanceId}
# Descrição: ${config.description}
# Intervalo: ${config.interval}
# Status: ${config.enabled ? 'Ativo' : 'Desabilitado'}
${config.enabled ? '' : '# '}${config.cron_expression} ${command} >> ${logFile} 2>&1`;
  }

  /**
   * Gerar script de cron para todas as instâncias
   */
  generateFullCronScript(authToken = 'YOUR_TOKEN_HERE') {
    const scripts = [];
    const timestamp = new Date().toISOString();

    scripts.push(`# Ultrabase - Diagnósticos Agendados`);
    scripts.push(`# Gerado automaticamente em: ${timestamp}`);
    scripts.push(`# Total de configurações: ${this.schedules.size}`);
    scripts.push('');

    this.schedules.forEach((config, instanceId) => {
      const script = this.generateCronScript(instanceId, authToken);
      if (script) {
        scripts.push(script);
        scripts.push('');
      }
    });

    return scripts.join('\n');
  }

  /**
   * Validar configuração de agendamento
   */
  validateScheduleConfig(config) {
    const errors = [];

    if (!config.instance_id) {
      errors.push('instance_id é obrigatório');
    }

    if (!config.interval || !this.intervalToCron(config.interval)) {
      errors.push('interval inválido');
    }

    if (typeof config.enabled !== 'boolean') {
      errors.push('enabled deve ser boolean');
    }

    if (config.max_retries && (typeof config.max_retries !== 'number' || config.max_retries < 0)) {
      errors.push('max_retries deve ser um número >= 0');
    }

    return errors;
  }

  /**
   * Obter estatísticas de agendamento
   */
  getSchedulingStats() {
    const configs = Array.from(this.schedules.values());
    
    const stats = {
      total_schedules: configs.length,
      enabled_schedules: configs.filter(c => c.enabled).length,
      disabled_schedules: configs.filter(c => !c.enabled).length,
      intervals: {},
      total_executions: configs.reduce((sum, c) => sum + (c.execution_count || 0), 0),
      most_active_instance: null,
      least_active_instance: null
    };

    // Contar intervalos
    configs.forEach(config => {
      stats.intervals[config.interval] = (stats.intervals[config.interval] || 0) + 1;
    });

    // Encontrar instâncias mais e menos ativas
    if (configs.length > 0) {
      const sorted = configs.sort((a, b) => (b.execution_count || 0) - (a.execution_count || 0));
      stats.most_active_instance = {
        instance_id: sorted[0].instance_id,
        executions: sorted[0].execution_count || 0
      };
      stats.least_active_instance = {
        instance_id: sorted[sorted.length - 1].instance_id,
        executions: sorted[sorted.length - 1].execution_count || 0
      };
    }

    return stats;
  }

  /**
   * Registrar execução de diagnóstico agendado
   */
  async recordExecution(instanceId, success = true, error = null) {
    const config = this.schedules.get(instanceId);
    if (!config) {
      return false;
    }

    config.last_execution = {
      timestamp: new Date().toISOString(),
      success: success,
      error: error
    };
    config.execution_count = (config.execution_count || 0) + 1;
    config.updated_at = new Date().toISOString();

    this.schedules.set(instanceId, config);
    await this.saveSchedules();

    return true;
  }
}

module.exports = ScheduledDiagnostics;