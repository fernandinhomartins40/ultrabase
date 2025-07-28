/**
 * ROLLBACK MANAGER - Sistema de rollback para correções falhadas
 * 
 * Restaura instâncias ao estado anterior quando correções falham.
 */

const fs = require('fs-extra');
const path = require('path');
const { execAsync } = require('util').promisify(require('child_process').exec);

class RollbackManager {
  constructor(config) {
    this.config = config;
    this.backupBaseDir = path.join(config.DOCKER_DIR, 'auto-repair-backups');
  }

  /**
   * Executa rollback completo de uma instância
   */
  async performRollback(instanceId, backupId) {
    try {
      console.log(`🔄 Iniciando rollback da instância ${instanceId} usando backup ${backupId}`);
      
      const rollbackLog = [];
      const startTime = Date.now();
      
      // 1. Verificar se backup existe e é válido
      console.log(`🔍 Verificando backup...`);
      const backupValidation = await this.validateBackup(backupId);
      
      if (!backupValidation.valid) {
        throw new Error(`Backup inválido: ${backupValidation.error}`);
      }

      rollbackLog.push({
        timestamp: new Date().toISOString(),
        action: 'backup_validated',
        details: backupValidation
      });

      // 2. Parar instância atual
      console.log(`⏸️ Parando instância atual...`);
      await this.stopCurrentInstance(instanceId);
      rollbackLog.push({
        timestamp: new Date().toISOString(),
        action: 'instance_stopped'
      });

      // 3. Restaurar configuração da instância
      console.log(`📄 Restaurando configuração...`);
      await this.restoreInstanceConfig(instanceId, backupId);
      rollbackLog.push({
        timestamp: new Date().toISOString(),
        action: 'config_restored'
      });

      // 4. Restaurar arquivos de ambiente
      console.log(`🔧 Restaurando arquivos de ambiente...`);
      await this.restoreEnvironmentFiles(instanceId, backupId);
      rollbackLog.push({
        timestamp: new Date().toISOString(),
        action: 'environment_restored'
      });

      // 5. Restaurar volumes de dados
      console.log(`💽 Restaurando volumes...`);
      await this.restoreVolumes(instanceId, backupId);
      rollbackLog.push({
        timestamp: new Date().toISOString(),
        action: 'volumes_restored'
      });

      // 6. Reiniciar instância
      console.log(`🚀 Reiniciando instância...`);
      await this.restartRestoredInstance(instanceId);
      rollbackLog.push({
        timestamp: new Date().toISOString(),
        action: 'instance_restarted'
      });

      // 7. Verificar se rollback foi bem-sucedido
      console.log(`✅ Verificando resultado do rollback...`);
      const rollbackSuccess = await this.verifyRollbackSuccess(instanceId);
      
      const endTime = Date.now();
      const duration = Math.round((endTime - startTime) / 1000);

      if (rollbackSuccess.success) {
        console.log(`✅ Rollback concluído com sucesso em ${duration}s`);
        
        rollbackLog.push({
          timestamp: new Date().toISOString(),
          action: 'rollback_completed',
          details: rollbackSuccess
        });

        return {
          success: true,
          message: `Rollback executado com sucesso em ${duration}s`,
          backup_used: backupId,
          rollback_log: rollbackLog,
          duration_seconds: duration,
          instance_status: rollbackSuccess
        };
      } else {
        throw new Error(`Rollback falhou na verificação: ${rollbackSuccess.error}`);
      }

    } catch (error) {
      console.error(`❌ Erro durante rollback:`, error);
      
      return {
        success: false,
        message: `Rollback falhou: ${error.message}`,
        backup_used: backupId,
        rollback_log: rollbackLog,
        error: error.message,
        manual_intervention_required: true
      };
    }
  }

  /**
   * Valida se backup pode ser usado para rollback
   */
  async validateBackup(backupId) {
    try {
      const backupDir = path.join(this.backupBaseDir, backupId);
      const manifestPath = path.join(backupDir, 'backup-manifest.json');
      
      if (!await fs.pathExists(manifestPath)) {
        return { valid: false, error: 'Backup manifest not found' };
      }

      const manifest = await fs.readJSON(manifestPath);
      
      // Verificar componentes críticos
      const criticalComponents = ['instance_config', 'environment_files'];
      const missingComponents = [];
      
      for (const component of criticalComponents) {
        if (!manifest.components[component]?.success) {
          missingComponents.push(component);
        }
      }

      if (missingComponents.length > 0) {
        return { 
          valid: false, 
          error: `Missing critical components: ${missingComponents.join(', ')}` 
        };
      }

      // Verificar se backup não é muito antigo (máximo 24 horas)
      const backupAge = Date.now() - new Date(manifest.timestamp).getTime();
      const maxAge = 24 * 60 * 60 * 1000; // 24 horas
      
      if (backupAge > maxAge) {
        console.warn(`⚠️ Backup é antigo (${Math.round(backupAge / 1000 / 3600)}h), mas será usado`);
      }

      return {
        valid: true,
        manifest: manifest,
        age_hours: Math.round(backupAge / 1000 / 3600)
      };

    } catch (error) {
      return { 
        valid: false, 
        error: error.message 
      };
    }
  }

  /**
   * Para instância atual antes do rollback
   */
  async stopCurrentInstance(instanceId) {
    try {
      const instanceManager = require('../../management/instance-manager');
      const instance = instanceManager.instances[instanceId];
      
      if (!instance) {
        console.warn(`⚠️ Instância ${instanceId} não encontrada na configuração`);
        return;
      }

      // Parar containers usando docker-compose
      const dockerDir = this.config.DOCKER_DIR;
      const composeFile = instance.docker.compose_file;
      
      const stopCommand = `cd "${dockerDir}" && docker compose -f "${composeFile}" stop`;
      await execAsync(stopCommand, { timeout: 60000 });
      
      console.log(`⏸️ Instância ${instanceId} parada`);
      
      // Aguardar containers pararem completamente
      await new Promise(resolve => setTimeout(resolve, 10000));

    } catch (error) {
      console.warn(`⚠️ Erro ao parar instância:`, error.message);
      // Não é crítico, continuar com rollback
    }
  }

  /**
   * Restaura configuração da instância
   */
  async restoreInstanceConfig(instanceId, backupId) {
    try {
      const backupDir = path.join(this.backupBaseDir, backupId);
      const configBackupPath = path.join(backupDir, 'instance-config.json');
      
      if (!await fs.pathExists(configBackupPath)) {
        throw new Error('Instance config backup not found');
      }

      const backupConfig = await fs.readJSON(configBackupPath);
      
      // Restaurar configuração no instanceManager
      const instanceManager = require('../../management/instance-manager');
      instanceManager.instances[instanceId] = backupConfig;
      instanceManager.saveInstances();
      
      console.log(`📄 Configuração da instância restaurada`);

    } catch (error) {
      throw new Error(`Failed to restore instance config: ${error.message}`);
    }
  }

  /**
   * Restaura arquivos de ambiente
   */
  async restoreEnvironmentFiles(instanceId, backupId) {
    try {
      const backupDir = path.join(this.backupBaseDir, backupId);
      const envBackupPath = path.join(backupDir, 'environment.env');
      
      if (!await fs.pathExists(envBackupPath)) {
        console.warn(`⚠️ Environment backup not found, skipping`);
        return;
      }

      const instanceManager = require('../../management/instance-manager');
      const instance = instanceManager.instances[instanceId];
      const envTargetPath = path.join(this.config.DOCKER_DIR, instance.docker.env_file);
      
      await fs.copy(envBackupPath, envTargetPath);
      
      console.log(`🔧 Arquivos de ambiente restaurados`);

    } catch (error) {
      console.warn(`⚠️ Failed to restore environment files:`, error.message);
      // Não é crítico, continuar
    }
  }

  /**
   * Restaura volumes de dados
   */
  async restoreVolumes(instanceId, backupId) {
    try {
      const backupDir = path.join(this.backupBaseDir, backupId);
      const volumesBackupPath = path.join(backupDir, 'volumes');
      
      if (!await fs.pathExists(volumesBackupPath)) {
        console.warn(`⚠️ Volumes backup not found, skipping`);
        return;
      }

      const volumesTargetPath = path.join(this.config.DOCKER_DIR, `volumes-${instanceId}`);
      
      // Remover volumes atuais se existirem
      if (await fs.pathExists(volumesTargetPath)) {
        await fs.remove(volumesTargetPath);
      }

      // Restaurar volumes do backup
      await fs.copy(volumesBackupPath, volumesTargetPath);
      
      // Calcular tamanho restaurado
      const restoredSize = await this.calculateDirectorySize(volumesTargetPath);
      
      console.log(`💽 Volumes restaurados (${restoredSize}MB)`);

    } catch (error) {
      console.warn(`⚠️ Failed to restore volumes:`, error.message);
      // Volumes são importantes, mas não críticos para rollback básico
    }
  }

  /**
   * Reinicia instância após restauração
   */
  async restartRestoredInstance(instanceId) {
    try {
      const instanceManager = require('../../management/instance-manager');
      const instance = instanceManager.instances[instanceId];
      
      const dockerDir = this.config.DOCKER_DIR;
      const composeFile = instance.docker.compose_file;
      const envFile = instance.docker.env_file;
      
      // Iniciar containers
      const startCommand = `cd "${dockerDir}" && docker compose -f "${composeFile}" --env-file "${envFile}" up -d`;
      await execAsync(startCommand, { timeout: 120000 });
      
      // Aguardar containers ficarem prontos
      await this.waitForInstanceReady(instanceId, 120000);
      
      console.log(`🚀 Instância reiniciada após rollback`);

    } catch (error) {
      throw new Error(`Failed to restart instance: ${error.message}`);
    }
  }

  /**
   * Aguarda instância ficar pronta após rollback
   */
  async waitForInstanceReady(instanceId, timeout = 120000) {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeout) {
      try {
        const instanceManager = require('../../management/instance-manager');
        const instance = instanceManager.instances[instanceId];
        
        // Testar conexão básica com database
        const { Pool } = require('pg');
        const pool = new Pool({
          host: 'localhost',
          port: instance.ports.postgres_ext,
          database: 'postgres',
          user: 'postgres',
          password: instance.credentials.postgres_password,
          connectionTimeoutMillis: 5000
        });
        
        await pool.query('SELECT 1');
        await pool.end();
        
        // Testar endpoint básico de saúde
        const fetch = require('node-fetch');
        const healthResponse = await fetch(
          `http://localhost:${instance.ports.kong_http}/auth/v1/health`,
          { timeout: 5000 }
        );
        
        if (healthResponse.ok) {
          console.log(`✅ Instância está respondendo após rollback`);
          return true;
        }
        
      } catch (error) {
        // Instância ainda não está pronta
      }
      
      console.log(`⏳ Aguardando instância ficar pronta...`);
      await new Promise(resolve => setTimeout(resolve, 10000));
    }
    
    throw new Error(`Instance not ready after ${timeout}ms`);
  }

  /**
   * Verifica se rollback foi bem-sucedido
   */
  async verifyRollbackSuccess(instanceId) {
    try {
      const instanceManager = require('../../management/instance-manager');
      const instance = instanceManager.instances[instanceId];
      
      const checks = {
        instance_config_loaded: !!instance,
        database_connection: false,
        basic_services: false
      };

      // Teste de conexão com database
      try {
        const { Pool } = require('pg');
        const pool = new Pool({
          host: 'localhost',
          port: instance.ports.postgres_ext,
          database: 'postgres',
          user: 'postgres',
          password: instance.credentials.postgres_password,
          connectionTimeoutMillis: 10000
        });
        
        await pool.query('SELECT version()');
        await pool.end();
        checks.database_connection = true;
      } catch (dbError) {
        console.warn(`⚠️ Database check failed:`, dbError.message);
      }

      // Teste de serviços básicos
      try {
        const fetch = require('node-fetch');
        const response = await fetch(
          `http://localhost:${instance.ports.kong_http}/auth/v1/health`,
          { timeout: 10000 }
        );
        checks.basic_services = response.ok;
      } catch (serviceError) {
        console.warn(`⚠️ Service check failed:`, serviceError.message);
      }

      const successfulChecks = Object.values(checks).filter(Boolean).length;
      const totalChecks = Object.keys(checks).length;
      const successRate = successfulChecks / totalChecks;

      return {
        success: successRate >= 0.6, // 60% dos checks devem passar
        checks: checks,
        success_rate: `${successfulChecks}/${totalChecks}`,
        error: successRate < 0.6 ? 'Not enough checks passed' : null
      };

    } catch (error) {
      return {
        success: false,
        error: error.message,
        checks: {}
      };
    }
  }

  /**
   * Lista rollbacks executados para uma instância
   */
  async getRollbackHistory(instanceId, limit = 10) {
    try {
      // Em implementação futura, isso consultaria um log de rollbacks
      // Por agora, retornar lista vazia
      return [];
    } catch (error) {
      console.error('Error getting rollback history:', error);
      return [];
    }
  }

  /**
   * Calcula tamanho de diretório
   */
  async calculateDirectorySize(dirPath) {
    try {
      const isWindows = process.platform === 'win32';
      
      if (isWindows) {
        const { stdout } = await execAsync(
          `powershell "Get-ChildItem -Path '${dirPath}' -Recurse | Measure-Object -Property Length -Sum | Select-Object Sum"`,
          { timeout: 30000 }
        );
        
        const sizeMatch = stdout.match(/(\d+)/);
        const sizeBytes = sizeMatch ? parseInt(sizeMatch[1]) : 0;
        return Math.round(sizeBytes / (1024 * 1024)); // MB
      } else {
        const { stdout } = await execAsync(`du -sm "${dirPath}" | cut -f1`, { timeout: 30000 });
        return parseInt(stdout.trim()) || 0;
      }
    } catch (error) {
      return 0;
    }
  }
}

module.exports = RollbackManager;