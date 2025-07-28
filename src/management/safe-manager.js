/**
 * SAFE INSTANCE MANAGER - Operações seguras de controle de instâncias
 * 
 * Gerencia operações críticas com segurança máxima:
 * - Restart seguro com backup automático
 * - Reparo automático de problemas detectados
 * - Verificação de integridade antes e depois
 * - Rollback automático em caso de falha
 */

const { execAsync } = require('util').promisify(require('child_process').exec);
const fs = require('fs-extra');
const path = require('path');
const BackupSystem = require('./backup-system');

class SafeInstanceManager {
  constructor(config, instanceManager, diagnostics) {
    this.config = config;
    this.instanceManager = instanceManager;
    this.diagnostics = diagnostics;
    this.backupSystem = new BackupSystem(config);
    
    // Timeouts para operações
    this.timeouts = {
      graceful_stop: 30000,    // 30s para parada graceful
      container_start: 60000,  // 1min para inicialização
      health_check: 30000,     // 30s para verificação de saúde
      operation_total: 300000  // 5min para operação completa
    };
  }

  /**
   * Restart seguro de uma instância com backup automático
   */
  async safeRestart(instanceId, options = {}) {
    const operationId = `restart_${instanceId}_${Date.now()}`;
    let backup = null;
    let preRestartState = null;

    try {
      console.log(`🔄 Iniciando restart seguro da instância ${instanceId}`);

      // Validações iniciais
      if (!this.instanceManager.instances[instanceId]) {
        throw new Error(`Instância ${instanceId} não encontrada`);
      }

      const instance = this.instanceManager.instances[instanceId];

      // 1. Criar backup automático de configurações
      console.log(`💾 Criando backup antes do restart...`);
      backup = await this.backupSystem.createInstanceBackup(instanceId, 'safe_restart');

      // 2. Capturar estado antes da parada
      console.log(`📸 Capturando estado pré-restart...`);
      preRestartState = await this.captureInstanceState(instanceId);

      // 3. Verificar se a instância precisa realmente de restart
      const needsRestart = options.force || await this.shouldRestart(instanceId);
      
      if (!needsRestart && !options.force) {
        console.log(`ℹ️ Instância ${instanceId} já está saudável, restart desnecessário`);
        return {
          success: true,
          message: 'Restart desnecessário - instância já está saudável',
          restart_performed: false,
          state_check: preRestartState
        };
      }

      // 4. Parada graceful com timeout
      console.log(`⏸️ Executando parada graceful...`);
      await this.gracefulStop(instanceId, this.timeouts.graceful_stop);

      // 5. Verificar integridade dos volumes antes de reiniciar
      console.log(`🔍 Verificando integridade dos volumes...`);
      await this.verifyVolumeIntegrity(instanceId);

      // 6. Iniciar containers com verificação de saúde
      console.log(`🚀 Iniciando containers...`);
      await this.startWithHealthCheck(instanceId);

      // 7. Verificação pós-restart detalhada
      console.log(`✅ Verificando estado pós-restart...`);
      const postRestartState = await this.verifyPostRestartState(instanceId, preRestartState);

      // 8. Atualizar status da instância
      instance.status = 'running';
      instance.updated_at = new Date().toISOString();
      instance.last_restart = new Date().toISOString();
      this.instanceManager.saveInstances();

      console.log(`✅ Restart seguro da instância ${instanceId} concluído com sucesso`);

      return {
        success: true,
        message: 'Restart seguro executado com sucesso',
        restart_performed: true,
        backup_created: backup.backup_id,
        pre_restart_state: preRestartState,
        post_restart_state: postRestartState,
        operation_id: operationId
      };

    } catch (error) {
      console.error(`❌ Erro durante restart seguro de ${instanceId}:`, error);

      // Tentar rollback automático se temos backup
      if (backup) {
        try {
          console.log(`🔄 Tentando rollback automático...`);
          await this.performEmergencyRollback(instanceId, backup, preRestartState);
          
          return {
            success: false,
            message: `Erro no restart, rollback executado: ${error.message}`,
            restart_performed: false,
            rollback_performed: true,
            backup_used: backup.backup_id,
            operation_id: operationId,
            error: error.message
          };
        } catch (rollbackError) {
          console.error(`❌ Erro crítico: falha no rollback automático:`, rollbackError);
          
          return {
            success: false,
            message: `ERRO CRÍTICO: Falha no restart E no rollback. Intervenção manual necessária.`,
            restart_performed: false,
            rollback_performed: false,
            backup_available: backup.backup_id,
            operation_id: operationId,
            error: error.message,
            rollback_error: rollbackError.message,
            manual_recovery_required: true
          };
        }
      }

      throw new Error(`Restart falhou: ${error.message}`);
    }
  }

  /**
   * Reparo automático de problemas detectados pelo diagnóstico
   */
  async repairInstance(instanceId, options = {}) {
    const operationId = `repair_${instanceId}_${Date.now()}`;
    let backup = null;

    try {
      console.log(`🔧 Iniciando reparo automático da instância ${instanceId}`);

      // 1. Executar diagnóstico para identificar problemas
      const diagnostic = await this.diagnostics.runFullDiagnostic(instanceId);
      
      if (diagnostic.overall_healthy && !options.force) {
        return {
          success: true,
          message: 'Nenhum reparo necessário - instância está saudável',
          repair_performed: false,
          diagnostic: diagnostic
        };
      }

      // 2. Criar backup antes de qualquer intervenção
      backup = await this.backupSystem.createInstanceBackup(instanceId, 'auto_repair');

      // 3. Analisar problemas e planejar ações de reparo
      const repairPlan = await this.planRepairActions(diagnostic);
      
      if (repairPlan.actions.length === 0) {
        return {
          success: false,
          message: 'Problemas detectados mas não há ações de reparo automáticas disponíveis',
          repair_performed: false,
          issues: diagnostic.critical_issues,
          manual_intervention_required: true
        };
      }

      console.log(`📋 Plano de reparo: ${repairPlan.actions.length} ações identificadas`);

      // 4. Executar ações de reparo uma por uma
      const repairResults = [];
      
      for (const action of repairPlan.actions) {
        try {
          console.log(`🔧 Executando ação: ${action.description}`);
          const result = await this.executeRepairAction(instanceId, action);
          repairResults.push({
            action: action.type,
            description: action.description,
            success: true,
            result: result
          });
        } catch (actionError) {
          console.error(`❌ Falha na ação de reparo ${action.type}:`, actionError);
          repairResults.push({
            action: action.type,
            description: action.description,
            success: false,
            error: actionError.message
          });

          // Se ação crítica falhou, parar o reparo
          if (action.critical) {
            throw new Error(`Ação crítica de reparo falhou: ${actionError.message}`);
          }
        }
      }

      // 5. Verificar se reparo foi bem-sucedido
      console.log(`🔍 Verificando resultado do reparo...`);
      const postRepairDiagnostic = await this.diagnostics.runFullDiagnostic(instanceId);
      
      const repairSuccessful = postRepairDiagnostic.overall_healthy || 
                              (postRepairDiagnostic.critical_issues.length < diagnostic.critical_issues.length);

      if (repairSuccessful) {
        console.log(`✅ Reparo automático da instância ${instanceId} concluído com sucesso`);
        
        return {
          success: true,
          message: `Reparo automático executado com sucesso`,
          repair_performed: true,
          backup_created: backup.backup_id,
          actions_executed: repairResults,
          pre_repair_issues: diagnostic.critical_issues.length,
          post_repair_issues: postRepairDiagnostic.critical_issues.length,
          operation_id: operationId
        };
      } else {
        throw new Error('Reparo executado mas problemas persistem');
      }

    } catch (error) {
      console.error(`❌ Erro durante reparo automático de ${instanceId}:`, error);

      // Se temos backup, oferecer rollback
      const response = {
        success: false,
        message: `Erro no reparo automático: ${error.message}`,
        repair_performed: false,
        operation_id: operationId,
        error: error.message
      };

      if (backup) {
        response.backup_available = backup.backup_id;
        response.rollback_available = true;
      }

      return response;
    }
  }

  /**
   * Determina se uma instância precisa de restart baseado no diagnóstico
   */
  async shouldRestart(instanceId) {
    try {
      const diagnostic = await this.diagnostics.runFullDiagnostic(instanceId);
      
      // Restart necessário se:
      // - Containers não estão rodando
      // - Serviços críticos não respondem
      // - Problemas de conectividade grave
      
      const needsRestart = 
        !diagnostic.results.container_status?.healthy ||
        !diagnostic.results.service_health?.overall_healthy ||
        diagnostic.critical_issues.some(issue => 
          ['infrastructure', 'authentication', 'database'].includes(issue.category)
        );

      return needsRestart;

    } catch (error) {
      console.warn(`⚠️ Erro ao verificar necessidade de restart:`, error);
      return true; // Em caso de dúvida, restart
    }
  }

  /**
   * Captura estado completo da instância antes de operações
   */
  async captureInstanceState(instanceId) {
    try {
      const instance = this.instanceManager.instances[instanceId];
      
      const state = {
        timestamp: new Date().toISOString(),
        instance_config: { ...instance },
        diagnostic: await this.diagnostics.quickHealthCheck(instanceId),
        container_status: await this.getContainerStates(instanceId)
      };

      return state;

    } catch (error) {
      console.warn(`⚠️ Erro ao capturar estado da instância:`, error);
      return {
        timestamp: new Date().toISOString(),
        capture_error: error.message
      };
    }
  }

  /**
   * Parada graceful de containers com timeout
   */
  async gracefulStop(instanceId, timeout = 30000) {
    try {
      const instance = this.instanceManager.instances[instanceId];
      const dockerDir = this.config.DOCKER_DIR;

      // Usar timeout do sistema operacional para garantir parada
      const timeoutSeconds = Math.floor(timeout / 1000);
      
      const command = process.platform === 'win32' 
        ? `cd "${dockerDir}" && timeout ${timeoutSeconds} docker compose -f "${instance.docker.compose_file}" stop`
        : `cd "${dockerDir}" && timeout ${timeoutSeconds}s docker compose -f "${instance.docker.compose_file}" stop`;

      const { stdout, stderr } = await execAsync(command, { timeout: timeout + 5000 });

      if (stderr && !stderr.includes('timeout')) {
        console.warn(`⚠️ Avisos durante parada:`, stderr);
      }

      console.log(`⏸️ Containers parados gracefully`);

    } catch (error) {
      if (error.message.includes('timeout')) {
        console.warn(`⚠️ Timeout na parada graceful, forçando parada...`);
        // Tentar parada forçada
        const instance = this.instanceManager.instances[instanceId];
        const forceCommand = `cd "${this.config.DOCKER_DIR}" && docker compose -f "${instance.docker.compose_file}" kill`;
        await execAsync(forceCommand, { timeout: 10000 });
      } else {
        throw error;
      }
    }
  }

  /**
   * Verifica integridade dos volumes antes de operações críticas
   */
  async verifyVolumeIntegrity(instanceId) {
    try {
      const volumePath = path.join(this.config.DOCKER_DIR, `volumes-${instanceId}`);
      
      if (!await fs.pathExists(volumePath)) {
        throw new Error(`Diretório de volumes não encontrado: ${volumePath}`);
      }

      // Verificar diretórios críticos
      const criticalDirs = ['db', 'storage'];
      
      for (const dir of criticalDirs) {
        const dirPath = path.join(volumePath, dir);
        if (!await fs.pathExists(dirPath)) {
          throw new Error(`Diretório crítico ausente: ${dir}`);
        }
      }

      // Verificar se há arquivos de lock ou corrupção óbvia
      const dbPath = path.join(volumePath, 'db', 'data');
      if (await fs.pathExists(dbPath)) {
        const lockFile = path.join(dbPath, 'postmaster.pid');
        if (await fs.pathExists(lockFile)) {
          // Remover lock file antigo se existir
          await fs.remove(lockFile);
          console.log(`🔓 Lock file do PostgreSQL removido`);
        }
      }

      console.log(`✅ Integridade dos volumes verificada`);

    } catch (error) {
      throw new Error(`Falha na verificação de integridade: ${error.message}`);
    }
  }

  /**
   * Inicia containers com verificação de saúde
   */
  async startWithHealthCheck(instanceId) {
    try {
      const instance = this.instanceManager.instances[instanceId];
      const dockerDir = this.config.DOCKER_DIR;

      // 1. Iniciar containers
      const startCommand = `cd "${dockerDir}" && docker compose -f "${instance.docker.compose_file}" --env-file "${instance.docker.env_file}" up -d`;
      
      console.log(`🚀 Iniciando containers...`);
      const { stdout, stderr } = await execAsync(startCommand, { 
        timeout: this.timeouts.container_start 
      });

      if (stderr && !stderr.toLowerCase().includes('warning')) {
        console.warn(`⚠️ Avisos durante inicialização:`, stderr);
      }

      // 2. Aguardar containers ficarem saudáveis
      console.log(`⏳ Aguardando containers ficarem prontos...`);
      await this.waitForContainersHealthy(instanceId);

      // 3. Verificação de saúde dos serviços
      console.log(`🔍 Verificando saúde dos serviços...`);
      const healthCheck = await this.diagnostics.quickHealthCheck(instanceId);
      
      if (!healthCheck.healthy) {
        throw new Error('Containers iniciados mas serviços não estão saudáveis');
      }

      console.log(`✅ Containers iniciados e serviços saudáveis`);

    } catch (error) {
      throw new Error(`Falha na inicialização: ${error.message}`);
    }
  }

  /**
   * Aguarda containers ficarem saudáveis com timeout
   */
  async waitForContainersHealthy(instanceId, maxWaitTime = 120000) {
    const startTime = Date.now();
    const checkInterval = 5000; // 5 segundos
    
    while (Date.now() - startTime < maxWaitTime) {
      try {
        const containerStates = await this.getContainerStates(instanceId);
        const allRunning = Object.values(containerStates).every(state => state.running);
        
        if (allRunning) {
          // Aguardar mais um pouco para serviços ficarem prontos
          await new Promise(resolve => setTimeout(resolve, 10000));
          return;
        }
        
        console.log(`⏳ Aguardando containers... (${Math.floor((Date.now() - startTime) / 1000)}s)`);
        await new Promise(resolve => setTimeout(resolve, checkInterval));
        
      } catch (error) {
        console.warn(`⚠️ Erro ao verificar estado dos containers:`, error.message);
        await new Promise(resolve => setTimeout(resolve, checkInterval));
      }
    }
    
    console.warn(`⚠️ Timeout aguardando containers ficarem saudáveis`);
  }

  /**
   * Verifica estado pós-restart comparando com estado anterior
   */
  async verifyPostRestartState(instanceId, preRestartState) {
    try {
      const postRestartState = await this.captureInstanceState(instanceId);
      
      const comparison = {
        healthy_before: preRestartState.diagnostic?.healthy || false,
        healthy_after: postRestartState.diagnostic?.healthy || false,
        containers_before: Object.keys(preRestartState.container_status || {}).length,
        containers_after: Object.keys(postRestartState.container_status || {}).length,
        improvement: false
      };

      // Determinar se houve melhora
      comparison.improvement = 
        postRestartState.diagnostic.healthy || 
        (comparison.healthy_after && !comparison.healthy_before) ||
        (comparison.containers_after >= comparison.containers_before);

      if (!comparison.improvement) {
        console.warn(`⚠️ Estado pós-restart não melhorou significativamente`);
      }

      return {
        post_restart_state: postRestartState,
        comparison: comparison,
        verification_successful: comparison.improvement
      };

    } catch (error) {
      console.error(`❌ Erro na verificação pós-restart:`, error);
      return {
        verification_error: error.message,
        verification_successful: false
      };
    }
  }

  /**
   * Rollback de emergência em caso de falha
   */
  async performEmergencyRollback(instanceId, backup, preRestartState) {
    try {
      console.log(`🚨 Executando rollback de emergência para instância ${instanceId}`);

      // 1. Parar containers atuais (podem estar em estado inconsistente)
      try {
        await this.gracefulStop(instanceId, 15000); // Timeout menor para emergência
      } catch (stopError) {
        console.warn(`⚠️ Erro ao parar containers durante rollback:`, stopError.message);
      }

      // 2. Restaurar configurações do backup
      await this.backupSystem.restoreInstanceFromBackup(instanceId, backup.backup_id);

      // 3. Reiniciar com configurações restauradas
      await this.startWithHealthCheck(instanceId);

      // 4. Verificar se rollback foi bem-sucedido
      const rollbackCheck = await this.diagnostics.quickHealthCheck(instanceId);
      
      if (!rollbackCheck.healthy) {
        throw new Error('Rollback executado mas instância ainda não está saudável');
      }

      console.log(`✅ Rollback de emergência executado com sucesso`);

    } catch (error) {
      console.error(`❌ ERRO CRÍTICO: Falha no rollback de emergência:`, error);
      throw new Error(`Rollback falhou: ${error.message}`);
    }
  }

  /**
   * Planeja ações de reparo baseadas no diagnóstico
   */
  async planRepairActions(diagnostic) {
    const actions = [];

    // Analisar problemas críticos e definir ações
    for (const issue of diagnostic.critical_issues) {
      switch (issue.category) {
        case 'infrastructure':
          if (issue.message.includes('containers não estão rodando')) {
            actions.push({
              type: 'restart_containers',
              description: 'Reiniciar containers que não estão rodando',
              critical: true,
              estimated_time: 60000 // 1 minuto
            });
          }
          break;

        case 'authentication':
          if (issue.message.includes('GoTrue')) {
            actions.push({
              type: 'restart_auth_service',
              description: 'Reiniciar serviço de autenticação (GoTrue)',
              critical: false,
              estimated_time: 30000 // 30 segundos
            });
          }
          break;

        case 'database':
          if (issue.message.includes('inacessível')) {
            actions.push({
              type: 'restart_database',
              description: 'Reiniciar container do PostgreSQL',
              critical: true,
              estimated_time: 45000 // 45 segundos
            });
          }
          break;

        case 'services':
          actions.push({
            type: 'restart_failed_services',
            description: 'Reiniciar serviços HTTP com falha',
            critical: false,
            estimated_time: 30000
          });
          break;
      }
    }

    return {
      actions: actions,
      total_estimated_time: actions.reduce((total, action) => total + action.estimated_time, 0),
      critical_actions: actions.filter(action => action.critical).length
    };
  }

  /**
   * Executa uma ação específica de reparo
   */
  async executeRepairAction(instanceId, action) {
    const instance = this.instanceManager.instances[instanceId];
    
    switch (action.type) {
      case 'restart_containers':
        // Restart completo de todos os containers
        await this.gracefulStop(instanceId, 20000);
        await this.startWithHealthCheck(instanceId);
        return 'Containers reiniciados com sucesso';

      case 'restart_auth_service':
        // Restart apenas do container de auth
        const authCommand = `docker restart supabase-auth-${instanceId}`;
        await execAsync(authCommand, { timeout: 30000 });
        await new Promise(resolve => setTimeout(resolve, 10000)); // Aguardar estabilizar
        return 'Serviço de autenticação reiniciado';

      case 'restart_database':
        // Restart apenas do container de database
        const dbCommand = `docker restart supabase-db-${instanceId}`;
        await execAsync(dbCommand, { timeout: 45000 });
        await new Promise(resolve => setTimeout(resolve, 15000)); // Aguardar DB inicializar
        return 'Database reiniciado';

      case 'restart_failed_services':
        // Restart dos containers de serviços HTTP
        const services = [`supabase-kong-${instanceId}`, `supabase-rest-${instanceId}`];
        for (const service of services) {
          await execAsync(`docker restart ${service}`, { timeout: 20000 });
        }
        return 'Serviços HTTP reiniciados';

      default:
        throw new Error(`Ação de reparo desconhecida: ${action.type}`);
    }
  }

  /**
   * Obtém estado atual de todos os containers da instância
   */
  async getContainerStates(instanceId) {
    try {
      const Docker = require('dockerode');
      const docker = new Docker();

      const containerNames = [
        `supabase-studio-${instanceId}`,
        `supabase-kong-${instanceId}`,
        `supabase-auth-${instanceId}`,
        `supabase-rest-${instanceId}`,
        `supabase-db-${instanceId}`,
        `supabase-storage-${instanceId}`,
        `realtime-dev.supabase-realtime-${instanceId}`
      ];

      const states = {};

      for (const containerName of containerNames) {
        try {
          const containers = await docker.listContainers({
            all: true,
            filters: { name: [containerName] }
          });

          if (containers.length > 0) {
            const container = containers[0];
            states[containerName] = {
              running: container.State === 'running',
              status: container.Status,
              state: container.State
            };
          } else {
            states[containerName] = {
              running: false,
              status: 'not_found',
              state: 'missing'
            };
          }
        } catch (containerError) {
          states[containerName] = {
            running: false,
            status: 'error',
            state: 'error',
            error: containerError.message
          };
        }
      }

      return states;

    } catch (error) {
      console.error(`❌ Erro ao obter estado dos containers:`, error);
      return {};
    }
  }
}

module.exports = SafeInstanceManager;