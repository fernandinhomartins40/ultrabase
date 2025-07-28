/**
 * REPAIR API - Interface REST para correções manuais
 * 
 * Fornece endpoints para a interface web executar correções de instâncias.
 */

const AutoRepairEngine = require('../auto-repair/auto-repair-engine');
const IntelligentProblemAnalyzer = require('../auto-repair/intelligent-analyzer');
const BackupManager = require('../auto-repair/backup-manager');

class RepairAPI {
  constructor(app, config, instanceManager, diagnostics) {
    this.app = app;
    this.config = config;
    this.instanceManager = instanceManager;
    this.diagnostics = diagnostics;
    
    // Inicializar componentes
    this.repairEngine = new AutoRepairEngine(config, instanceManager, diagnostics);
    this.analyzer = new IntelligentProblemAnalyzer();
    this.backupManager = new BackupManager(config);
    
    // Registrar rotas
    this.registerRoutes();
  }

  /**
   * Registra todas as rotas da API de correção
   */
  registerRoutes() {
    // Análise de problemas
    this.app.get('/api/instances/:id/repair-analysis', this.analyzeProblems.bind(this));
    
    // Execução de correção
    this.app.post('/api/instances/:id/auto-repair', this.executeRepair.bind(this));
    
    // Status de operação
    this.app.get('/api/repair/:operationId/status', this.getRepairStatus.bind(this));
    
    // Cancelar operação
    this.app.post('/api/repair/:operationId/cancel', this.cancelRepair.bind(this));
    
    // Histórico de correções
    this.app.get('/api/instances/:id/repair-history', this.getRepairHistory.bind(this));
    
    // Backups disponíveis
    this.app.get('/api/instances/:id/backups', this.listBackups.bind(this));
    
    // Rollback manual
    this.app.post('/api/instances/:id/rollback', this.executeRollback.bind(this));
  }

  /**
   * Analisa problemas de uma instância e sugere correções
   */
  async analyzeProblems(req, res) {
    try {
      const instanceId = req.params.id;
      
      console.log(`🔍 Analisando problemas da instância ${instanceId}...`);
      
      // Verificar se instância existe
      if (!this.instanceManager.instances[instanceId]) {
        return res.status(404).json({
          success: false,
          message: 'Instância não encontrada'
        });
      }

      // Executar diagnóstico
      const diagnostic = await this.diagnostics.runFullDiagnostic(instanceId);
      
      if (diagnostic.overall_healthy) {
        return res.json({
          success: true,
          healthy: true,
          message: 'Instância está saudável - nenhuma correção necessária',
          diagnostic: diagnostic
        });
      }

      // Analisar problemas
      const analysis = this.analyzer.analyzeProblemChain(diagnostic);
      
      if (!analysis.success) {
        return res.status(500).json({
          success: false,
          message: 'Falha na análise de problemas',
          diagnostic: diagnostic
        });
      }

      // Sugerir tipo de correção
      const repairType = this.analyzer.suggestRepairType(diagnostic);
      
      res.json({
        success: true,
        healthy: false,
        instance_id: instanceId,
        problems_found: diagnostic.critical_issues.length,
        suggested_repair_type: repairType,
        repair_plan: {
          total_actions: analysis.actions.length,
          estimated_time: analysis.summary.estimatedDuration,
          critical_actions: analysis.criticalActionsCount,
          phases: Object.keys(analysis.phases),
          actions: analysis.actions.map(action => ({
            type: action.type,
            description: action.description,
            category: action.category,
            critical: action.critical,
            estimated_time: action.estimatedTime
          }))
        },
        diagnostic: diagnostic
      });

    } catch (error) {
      console.error(`❌ Erro na análise de problemas:`, error);
      res.status(500).json({
        success: false,
        message: 'Erro interno na análise de problemas',
        error: error.message
      });
    }
  }

  /**
   * Executa correção de uma instância
   */
  async executeRepair(req, res) {
    try {
      const instanceId = req.params.id;
      const options = req.body;
      
      console.log(`🔧 Executando correção da instância ${instanceId}...`);
      
      // Validações
      if (!options.userConfirmed) {
        return res.status(400).json({
          success: false,
          message: 'Confirmação do usuário é obrigatória'
        });
      }

      if (!this.instanceManager.instances[instanceId]) {
        return res.status(404).json({
          success: false,
          message: 'Instância não encontrada'
        });
      }

      // Configurar opções padrão
      const repairOptions = {
        backup: options.backup !== false, // Default true
        aggressive: options.aggressive || false,
        skipValidation: options.skipValidation || false,
        userTriggered: true,
        autoRollback: options.autoRollback !== false, // Default true
        force: options.force || false
      };

      // Executar correção (operação assíncrona)
      const repairPromise = this.repairEngine.executeInstanceRepair(instanceId, repairOptions);
      
      // Retornar resposta imediata com operation_id
      const operationId = `repair_${instanceId}_${Date.now()}`;
      
      // Armazenar promise para consulta posterior
      this.storeOperation(operationId, repairPromise);
      
      // Aguardar resultado (com timeout para não travar a resposta)
      try {
        const result = await Promise.race([
          repairPromise,
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Operation timeout')), 300000) // 5 minutos
          )
        ]);

        res.json({
          success: result.success,
          message: result.message,
          operation_id: operationId,
          repair_performed: result.repair_performed,
          backup_created: result.backup_created,
          actions_executed: result.actions_executed,
          actions_failed: result.actions_failed,
          duration_seconds: result.duration_seconds,
          rollback_performed: result.rollback_performed
        });

      } catch (timeoutError) {
        if (timeoutError.message === 'Operation timeout') {
          res.json({
            success: false,
            message: 'Operação em andamento - consulte status com operation_id',
            operation_id: operationId,
            status: 'running'
          });
        } else {
          throw timeoutError;
        }
      }

    } catch (error) {
      console.error(`❌ Erro na execução de correção:`, error);
      res.status(500).json({
        success: false,
        message: 'Erro interno na execução de correção',
        error: error.message
      });
    }
  }

  /**
   * Obtém status de uma operação de correção
   */
  async getRepairStatus(req, res) {
    try {
      const operationId = req.params.operationId;
      
      const operation = this.getStoredOperation(operationId);
      
      if (!operation) {
        return res.status(404).json({
          success: false,
          message: 'Operação não encontrada'
        });
      }

      // Verificar se operação já foi concluída
      if (operation.completed) {
        res.json({
          success: true,
          operation_id: operationId,
          status: operation.result.success ? 'completed' : 'failed',
          progress: 100,
          result: operation.result
        });
      } else {
        res.json({
          success: true,
          operation_id: operationId,
          status: 'running',
          progress: 50, // Estimativa
          message: 'Operação em andamento'
        });
      }

    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Erro ao consultar status',
        error: error.message
      });
    }
  }

  /**
   * Cancela uma operação de correção
   */
  async cancelRepair(req, res) {
    try {
      const operationId = req.params.operationId;
      
      // Implementação futura - cancelamento de operações
      res.json({
        success: false,
        message: 'Cancelamento não implementado ainda'
      });

    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Erro ao cancelar operação',
        error: error.message
      });
    }
  }

  /**
   * Obtém histórico de correções de uma instância
   */
  async getRepairHistory(req, res) {
    try {
      const instanceId = req.params.id;
      const limit = parseInt(req.query.limit) || 10;
      
      // Implementação futura - histórico de correções
      res.json({
        success: true,
        instance_id: instanceId,
        repairs: [],
        message: 'Histórico não implementado ainda'
      });

    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Erro ao obter histórico',
        error: error.message
      });
    }
  }

  /**
   * Lista backups disponíveis para uma instância
   */
  async listBackups(req, res) {
    try {
      const instanceId = req.params.id;
      
      const backups = await this.backupManager.listBackups(instanceId);
      
      res.json({
        success: true,
        instance_id: instanceId,
        backups: backups.map(backup => ({
          backup_id: backup.backup_id,
          timestamp: backup.timestamp,
          reason: backup.reason,
          size_mb: backup.size_mb,
          components: Object.keys(backup.components || {}),
          age_hours: Math.round((Date.now() - new Date(backup.timestamp).getTime()) / 1000 / 3600)
        }))
      });

    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Erro ao listar backups',
        error: error.message
      });
    }
  }

  /**
   * Executa rollback manual para um backup específico
   */
  async executeRollback(req, res) {
    try {
      const instanceId = req.params.id;
      const { backup_id, userConfirmed } = req.body;
      
      if (!userConfirmed) {
        return res.status(400).json({
          success: false,
          message: 'Confirmação do usuário é obrigatória para rollback'
        });
      }

      if (!backup_id) {
        return res.status(400).json({
          success: false,
          message: 'backup_id é obrigatório'
        });
      }

      console.log(`🔄 Executando rollback da instância ${instanceId} para backup ${backup_id}...`);
      
      const result = await this.repairEngine.rollbackManager.performRollback(instanceId, backup_id);
      
      res.json({
        success: result.success,
        message: result.message,
        backup_used: result.backup_used,
        duration_seconds: result.duration_seconds,
        instance_status: result.instance_status,
        manual_intervention_required: result.manual_intervention_required
      });

    } catch (error) {
      console.error(`❌ Erro no rollback:`, error);
      res.status(500).json({
        success: false,
        message: 'Erro interno no rollback',
        error: error.message
      });
    }
  }

  /**
   * Armazena operação para consulta posterior
   */
  storeOperation(operationId, promise) {
    if (!this.operations) {
      this.operations = new Map();
    }
    
    this.operations.set(operationId, {
      promise: promise,
      completed: false,
      startTime: Date.now()
    });
    
    // Aguardar conclusão da operação
    promise.then(result => {
      const operation = this.operations.get(operationId);
      if (operation) {
        operation.completed = true;
        operation.result = result;
      }
    }).catch(error => {
      const operation = this.operations.get(operationId);
      if (operation) {
        operation.completed = true;
        operation.result = { success: false, error: error.message };
      }
    });
    
    // Limpeza automática após 1 hora
    setTimeout(() => {
      this.operations.delete(operationId);
    }, 3600000);
  }

  /**
   * Obtém operação armazenada
   */
  getStoredOperation(operationId) {
    if (!this.operations) {
      return null;
    }
    return this.operations.get(operationId);
  }
}

module.exports = RepairAPI;