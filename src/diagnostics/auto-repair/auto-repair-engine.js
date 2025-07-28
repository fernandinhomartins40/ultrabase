/**
 * AUTO REPAIR ENGINE - Motor principal de correção de instâncias
 * 
 * Executa correções de problemas das instâncias Supabase baseado em planos
 * criados pelo analisador inteligente.
 */

const IntelligentProblemAnalyzer = require('./intelligent-analyzer');
const ContainerFixer = require('./container-fixer');
const CredentialManager = require('./credential-manager');
const NetworkFixer = require('./network-fixer');
const ServiceFixer = require('./service-fixer');
const BackupManager = require('./backup-manager');
const RollbackManager = require('./rollback-manager');

class AutoRepairEngine {
  constructor(config, instanceManager, diagnostics) {
    this.config = config;
    this.instanceManager = instanceManager;
    this.diagnostics = diagnostics;
    
    // Inicializar componentes especializados
    this.analyzer = new IntelligentProblemAnalyzer();
    this.containerFixer = new ContainerFixer(config);
    this.credentialManager = new CredentialManager(config);
    this.networkFixer = new NetworkFixer(config);
    this.serviceFixer = new ServiceFixer(config);
    this.backupManager = new BackupManager(config);
    this.rollbackManager = new RollbackManager(config);
    
    // Timeouts para operações
    this.timeouts = {
      phase: 300000,        // 5 minutos por fase
      action: 120000,       // 2 minutos por ação
      verification: 60000,  // 1 minuto para verificação
      rollback: 180000      // 3 minutos para rollback
    };
  }

  /**
   * Executa correção completa de uma instância (método principal)
   */
  async executeInstanceRepair(instanceId, options = {}) {
    const operationId = `repair_${instanceId}_${Date.now()}`;
    let backup = null;
    let executionLog = [];

    try {
      console.log(`🔧 Iniciando correção automática da instância ${instanceId}`);
      
      const startTime = Date.now();
      executionLog.push({ 
        timestamp: new Date().toISOString(), 
        action: 'repair_started', 
        details: { instanceId, options, operationId } 
      });

      // 1. Validações iniciais
      const instance = await this.validateInstance(instanceId);
      
      // 2. Executar diagnóstico inicial
      console.log(`📋 Executando diagnóstico inicial...`);
      const diagnostic = await this.diagnostics.runFullDiagnostic(instanceId);
      
      if (diagnostic.overall_healthy && !options.force) {
        return {
          success: true,
          message: 'Instância já está saudável - nenhuma correção necessária',
          repair_performed: false,
          diagnostic: diagnostic,
          operation_id: operationId
        };
      }

      // 3. Analisar problemas e criar plano de correção
      console.log(`🔍 Analisando problemas e criando plano de correção...`);
      const repairPlan = this.analyzer.analyzeProblemChain(diagnostic);
      
      if (!repairPlan.success || repairPlan.actions.length === 0) {
        return {
          success: false,
          message: 'Não foi possível criar plano de correção automática',
          repair_performed: false,
          issues: diagnostic.critical_issues,
          manual_intervention_required: true,
          operation_id: operationId
        };
      }

      console.log(`📋 Plano criado: ${repairPlan.actions.length} ações, tempo estimado: ${repairPlan.summary.estimatedDuration}`);
      executionLog.push({ 
        timestamp: new Date().toISOString(), 
        action: 'plan_created', 
        details: repairPlan.summary 
      });

      // 4. Criar backup se solicitado
      if (options.backup !== false) {
        console.log(`💾 Criando backup da instância...`);
        backup = await this.backupManager.createInstanceBackup(instanceId, 'auto_repair');
        executionLog.push({ 
          timestamp: new Date().toISOString(), 
          action: 'backup_created', 
          details: { backup_id: backup.backup_id } 
        });
      }

      // 5. Executar plano de correção
      console.log(`🚀 Executando plano de correção...`);
      const repairResults = await this.executePlan(instanceId, repairPlan, executionLog);

      // 6. Verificar resultado final
      console.log(`🔍 Verificando resultado da correção...`);
      const finalDiagnostic = await this.diagnostics.runFullDiagnostic(instanceId);
      const repairSuccessful = this.evaluateRepairSuccess(diagnostic, finalDiagnostic);

      const endTime = Date.now();
      const totalDuration = Math.round((endTime - startTime) / 1000);

      if (repairSuccessful) {
        console.log(`✅ Correção da instância ${instanceId} concluída com sucesso em ${totalDuration}s`);
        
        // Atualizar status da instância
        if (instance) {
          instance.status = 'running';
          instance.updated_at = new Date().toISOString();
          instance.last_repair = new Date().toISOString();
          this.instanceManager.saveInstances();
        }

        return {
          success: true,
          message: `Correção executada com sucesso em ${totalDuration}s`,
          repair_performed: true,
          backup_created: backup?.backup_id || null,
          actions_executed: repairResults.successful,
          actions_failed: repairResults.failed,
          pre_repair_issues: diagnostic.critical_issues.length,
          post_repair_issues: finalDiagnostic.critical_issues.length,
          execution_log: executionLog,
          operation_id: operationId,
          duration_seconds: totalDuration
        };
      } else {
        throw new Error('Correção executada mas problemas persistem');
      }

    } catch (error) {
      console.error(`❌ Erro durante correção da instância ${instanceId}:`, error);
      
      executionLog.push({ 
        timestamp: new Date().toISOString(), 
        action: 'repair_failed', 
        details: { error: error.message } 
      });

      // Tentar rollback se temos backup
      if (backup && options.autoRollback !== false) {
        try {
          console.log(`🔄 Executando rollback automático...`);
          await this.rollbackManager.performRollback(instanceId, backup.backup_id);
          
          executionLog.push({ 
            timestamp: new Date().toISOString(), 
            action: 'rollback_completed', 
            details: { backup_id: backup.backup_id } 
          });

          return {
            success: false,
            message: `Erro na correção, rollback executado: ${error.message}`,
            repair_performed: false,
            rollback_performed: true,
            backup_used: backup.backup_id,
            execution_log: executionLog,
            operation_id: operationId,
            error: error.message
          };
        } catch (rollbackError) {
          console.error(`❌ Erro crítico no rollback:`, rollbackError);
          
          return {
            success: false,
            message: 'ERRO CRÍTICO: Falha na correção E no rollback',
            repair_performed: false,
            rollback_performed: false,
            backup_available: backup.backup_id,
            execution_log: executionLog,
            operation_id: operationId,
            error: error.message,
            rollback_error: rollbackError.message,
            manual_recovery_required: true
          };
        }
      }

      return {
        success: false,
        message: `Erro na correção: ${error.message}`,
        repair_performed: false,
        backup_available: backup?.backup_id || null,
        execution_log: executionLog,
        operation_id: operationId,
        error: error.message
      };
    }
  }

  /**
   * Executa plano de correção fase por fase
   */
  async executePlan(instanceId, repairPlan, executionLog) {
    const results = {
      successful: [],
      failed: [],
      skipped: []
    };

    // Executar ações por fase (respeitando dependências)
    const phases = Object.keys(repairPlan.phases);
    
    for (const phaseName of phases) {
      const phaseActions = repairPlan.phases[phaseName];
      
      if (phaseActions.length === 0) continue;

      console.log(`📋 Executando fase: ${phaseName} (${phaseActions.length} ações)`);
      
      executionLog.push({ 
        timestamp: new Date().toISOString(), 
        action: 'phase_started', 
        details: { phase: phaseName, actions: phaseActions.length } 
      });

      try {
        // Executar ações da fase
        for (const action of phaseActions) {
          try {
            console.log(`🔧 Executando: ${action.description}`);
            
            const actionResult = await Promise.race([
              this.executeAction(instanceId, action),
              new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Action timeout')), this.timeouts.action)
              )
            ]);

            results.successful.push({
              action: action.type,
              description: action.description,
              result: actionResult,
              duration: actionResult.duration || 0
            });

            executionLog.push({ 
              timestamp: new Date().toISOString(), 
              action: 'action_completed', 
              details: { type: action.type, description: action.description } 
            });

            // Pausa entre ações para evitar sobrecarga
            await new Promise(resolve => setTimeout(resolve, 2000));

          } catch (actionError) {
            console.error(`❌ Falha na ação ${action.type}:`, actionError.message);
            
            results.failed.push({
              action: action.type,
              description: action.description,
              error: actionError.message
            });

            executionLog.push({ 
              timestamp: new Date().toISOString(), 
              action: 'action_failed', 
              details: { type: action.type, error: actionError.message } 
            });

            // Se ação crítica falhou, parar execução
            if (action.critical) {
              throw new Error(`Ação crítica falhou: ${action.description} - ${actionError.message}`);
            }
          }
        }

        // Verificar saúde após cada fase
        console.log(`🔍 Verificando saúde após fase ${phaseName}...`);
        const phaseCheck = await this.diagnostics.quickHealthCheck(instanceId);
        
        executionLog.push({ 
          timestamp: new Date().toISOString(), 
          action: 'phase_health_check', 
          details: { phase: phaseName, healthy: phaseCheck.healthy } 
        });

        console.log(`✅ Fase ${phaseName} concluída`);

      } catch (phaseError) {
        console.error(`❌ Falha na fase ${phaseName}:`, phaseError.message);
        
        executionLog.push({ 
          timestamp: new Date().toISOString(), 
          action: 'phase_failed', 
          details: { phase: phaseName, error: phaseError.message } 
        });

        throw phaseError; // Propagar erro para nível superior
      }

      // Pausa entre fases
      await new Promise(resolve => setTimeout(resolve, 5000));
    }

    return results;
  }

  /**
   * Executa uma ação específica de correção
   */
  async executeAction(instanceId, action) {
    const startTime = Date.now();

    try {
      let result;

      switch (action.method) {
        case 'fixStoppedContainers':
          result = await this.containerFixer.fixStoppedContainers(instanceId, action.parameters);
          break;

        case 'fixDatabaseCredentials':
          result = await this.credentialManager.regenerateCredentials(instanceId, action.parameters);
          break;

        case 'restartDatabaseContainer':
          result = await this.containerFixer.restartDatabaseContainer(instanceId, action.parameters);
          break;

        case 'fixNetworkConnectivity':
          result = await this.networkFixer.fixConnectivity(instanceId, action.parameters);
          break;

        case 'restartAuthService':
          result = await this.serviceFixer.restartAuthService(instanceId, action.parameters);
          break;

        case 'restartHttpServices':
          result = await this.serviceFixer.restartHttpServices(instanceId, action.parameters);
          break;

        default:
          throw new Error(`Método de correção desconhecido: ${action.method}`);
      }

      const duration = Date.now() - startTime;
      
      return {
        success: true,
        result: result,
        duration: Math.round(duration / 1000),
        message: `${action.description} executada com sucesso`
      };

    } catch (error) {
      const duration = Date.now() - startTime;
      
      throw new Error(`${action.description} falhou após ${Math.round(duration / 1000)}s: ${error.message}`);
    }
  }

  /**
   * Valida se instância existe e está acessível
   */
  async validateInstance(instanceId) {
    const instance = this.instanceManager.instances[instanceId];
    
    if (!instance) {
      throw new Error(`Instância ${instanceId} não encontrada`);
    }

    if (instance.status === 'creating') {
      throw new Error(`Instância ${instanceId} ainda está sendo criada`);
    }

    return instance;
  }

  /**
   * Avalia se a correção foi bem-sucedida
   */
  evaluateRepairSuccess(beforeDiagnostic, afterDiagnostic) {
    // Correção bem-sucedida se:
    // 1. Instância está saudável OU
    // 2. Número de problemas críticos diminuiu significativamente
    
    const wasHealthy = beforeDiagnostic.overall_healthy;
    const isHealthy = afterDiagnostic.overall_healthy;
    
    if (isHealthy) {
      return true; // Instância agora está completamente saudável
    }

    const beforeIssues = beforeDiagnostic.critical_issues.length;
    const afterIssues = afterDiagnostic.critical_issues.length;
    
    // Se reduziu pelo menos 70% dos problemas críticos
    const improvementRatio = (beforeIssues - afterIssues) / beforeIssues;
    return improvementRatio >= 0.7;
  }

  /**
   * Obtém status atual de uma operação de correção
   */
  async getRepairStatus(operationId) {
    // Em implementação futura, isso consultaria um banco de dados
    // ou cache para status de operações em andamento
    return {
      operation_id: operationId,
      status: 'completed', // ou 'running', 'failed'
      progress: 100,
      message: 'Status não implementado ainda'
    };
  }

  /**
   * Cancela uma operação de correção em andamento
   */
  async cancelRepair(operationId) {
    // Em implementação futura, isso sinalizaria para parar
    // a operação de correção em andamento
    return {
      success: false,
      message: 'Cancelamento não implementado ainda'
    };
  }
}

module.exports = AutoRepairEngine;