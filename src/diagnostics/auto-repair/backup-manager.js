/**
 * BACKUP MANAGER - Sistema de backup para auto-correção
 * 
 * Gerencia backups automáticos antes de correções e rollbacks em caso de falha.
 */

const fs = require('fs-extra');
const path = require('path');
const { execAsync } = require('util').promisify(require('child_process').exec);

class BackupManager {
  constructor(config) {
    this.config = config;
    this.backupBaseDir = path.join(config.DOCKER_DIR, 'auto-repair-backups');
  }

  /**
   * Cria backup completo de uma instância antes de correção
   */
  async createInstanceBackup(instanceId, reason = 'auto_repair') {
    try {
      console.log(`💾 Criando backup da instância ${instanceId} para ${reason}`);
      
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupId = `${instanceId}_${reason}_${timestamp}`;
      const backupDir = path.join(this.backupBaseDir, backupId);
      
      await fs.ensureDir(backupDir);
      
      const backupData = {
        backup_id: backupId,
        instanceId: instanceId,
        reason: reason,
        timestamp: new Date().toISOString(),
        components: {},
        success: false
      };

      // 1. Backup da configuração da instância
      console.log(`📄 Backup da configuração...`);
      await this.backupInstanceConfig(instanceId, backupDir, backupData);

      // 2. Backup dos arquivos de ambiente
      console.log(`🔧 Backup dos arquivos de ambiente...`);
      await this.backupEnvironmentFiles(instanceId, backupDir, backupData);

      // 3. Backup dos volumes de dados
      console.log(`💽 Backup dos volumes...`);
      await this.backupVolumes(instanceId, backupDir, backupData);

      // 4. Backup do estado dos containers
      console.log(`🐳 Backup do estado dos containers...`);
      await this.backupContainerState(instanceId, backupDir, backupData);

      // 5. Criar manifesto do backup
      backupData.success = true;
      backupData.size_mb = await this.calculateBackupSize(backupDir);
      
      const manifestPath = path.join(backupDir, 'backup-manifest.json');
      await fs.writeJSON(manifestPath, backupData, { spaces: 2 });

      console.log(`✅ Backup criado: ${backupId} (${backupData.size_mb}MB)`);
      
      return backupData;

    } catch (error) {
      console.error(`❌ Erro ao criar backup:`, error);
      throw new Error(`Falha na criação do backup: ${error.message}`);
    }
  }

  /**
   * Backup da configuração da instância
   */
  async backupInstanceConfig(instanceId, backupDir, backupData) {
    try {
      const instanceManager = require('../../management/instance-manager');
      const instance = instanceManager.instances[instanceId];
      
      if (!instance) {
        throw new Error(`Instância ${instanceId} não encontrada`);
      }

      const configPath = path.join(backupDir, 'instance-config.json');
      await fs.writeJSON(configPath, instance, { spaces: 2 });
      
      backupData.components.instance_config = {
        success: true,
        path: 'instance-config.json'
      };

    } catch (error) {
      backupData.components.instance_config = {
        success: false,
        error: error.message
      };
      throw error;
    }
  }

  /**
   * Backup dos arquivos de ambiente
   */
  async backupEnvironmentFiles(instanceId, backupDir, backupData) {
    try {
      const instanceManager = require('../../management/instance-manager');
      const instance = instanceManager.instances[instanceId];
      
      const envSourcePath = path.join(this.config.DOCKER_DIR, instance.docker.env_file);
      const envBackupPath = path.join(backupDir, 'environment.env');
      
      if (await fs.pathExists(envSourcePath)) {
        await fs.copy(envSourcePath, envBackupPath);
        backupData.components.environment_files = {
          success: true,
          files: ['environment.env']
        };
      } else {
        throw new Error(`Arquivo .env não encontrado: ${envSourcePath}`);
      }

    } catch (error) {
      backupData.components.environment_files = {
        success: false,
        error: error.message
      };
      // Não é crítico, continuar
      console.warn(`⚠️ Falha no backup de arquivos de ambiente:`, error.message);
    }
  }

  /**
   * Backup dos volumes de dados
   */
  async backupVolumes(instanceId, backupDir, backupData) {
    try {
      const volumesSourceDir = path.join(this.config.DOCKER_DIR, `volumes-${instanceId}`);
      const volumesBackupDir = path.join(backupDir, 'volumes');
      
      if (await fs.pathExists(volumesSourceDir)) {
        await fs.copy(volumesSourceDir, volumesBackupDir);
        
        // Calcular tamanho dos volumes
        const volumeSize = await this.calculateDirectorySize(volumesBackupDir);
        
        backupData.components.volumes = {
          success: true,
          path: 'volumes/',
          size_mb: volumeSize
        };
        
        console.log(`💽 Volumes copiados (${volumeSize}MB)`);
      } else {
        console.warn(`⚠️ Diretório de volumes não encontrado: ${volumesSourceDir}`);
        backupData.components.volumes = {
          success: false,
          error: 'Volume directory not found'
        };
      }

    } catch (error) {
      backupData.components.volumes = {
        success: false,
        error: error.message
      };
      console.warn(`⚠️ Falha no backup de volumes:`, error.message);
    }
  }

  /**
   * Backup do estado dos containers
   */
  async backupContainerState(instanceId, backupDir, backupData) {
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

      const containerStates = {};

      for (const containerName of containerNames) {
        try {
          const containers = await docker.listContainers({
            all: true,
            filters: { name: [containerName] }
          });

          if (containers.length > 0) {
            const container = containers[0];
            const containerObj = docker.getContainer(container.Id);
            const inspect = await containerObj.inspect();
            
            containerStates[containerName] = {
              id: container.Id,
              state: container.State,
              status: container.Status,
              created: container.Created,
              image: container.Image,
              config: {
                env: inspect.Config.Env,
                cmd: inspect.Config.Cmd,
                volumes: inspect.Config.Volumes
              }
            };
          } else {
            containerStates[containerName] = {
              state: 'not_found'
            };
          }
        } catch (containerError) {
          containerStates[containerName] = {
            state: 'error',
            error: containerError.message
          };
        }
      }

      const statePath = path.join(backupDir, 'container-states.json');
      await fs.writeJSON(statePath, containerStates, { spaces: 2 });
      
      backupData.components.container_state = {
        success: true,
        path: 'container-states.json',
        containers: Object.keys(containerStates).length
      };

    } catch (error) {
      backupData.components.container_state = {
        success: false,
        error: error.message
      };
      console.warn(`⚠️ Falha no backup do estado dos containers:`, error.message);
    }
  }

  /**
   * Lista backups disponíveis para uma instância
   */
  async listBackups(instanceId = null) {
    try {
      if (!await fs.pathExists(this.backupBaseDir)) {
        return [];
      }

      const backupDirs = await fs.readdir(this.backupBaseDir);
      const backups = [];

      for (const backupDir of backupDirs) {
        // Filtrar por instância se especificado
        if (instanceId && !backupDir.startsWith(instanceId)) {
          continue;
        }

        const manifestPath = path.join(this.backupBaseDir, backupDir, 'backup-manifest.json');
        
        if (await fs.pathExists(manifestPath)) {
          try {
            const manifest = await fs.readJSON(manifestPath);
            backups.push(manifest);
          } catch (error) {
            console.warn(`⚠️ Manifesto de backup corrompido: ${backupDir}`);
          }
        }
      }

      // Ordenar por timestamp (mais recente primeiro)
      backups.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

      return backups;

    } catch (error) {
      console.error('❌ Erro ao listar backups:', error);
      return [];
    }
  }

  /**
   * Remove backups antigos (manter apenas os mais recentes)
   */
  async cleanupOldBackups(instanceId, keepCount = 5) {
    try {
      console.log(`🧹 Limpando backups antigos da instância ${instanceId}...`);
      
      const backups = await this.listBackups(instanceId);
      
      if (backups.length <= keepCount) {
        console.log(`📋 ${backups.length} backups encontrados, nenhum removido`);
        return { removed: 0, kept: backups.length };
      }

      const toRemove = backups.slice(keepCount);
      let removedCount = 0;

      for (const backup of toRemove) {
        try {
          const backupPath = path.join(this.backupBaseDir, backup.backup_id);
          await fs.remove(backupPath);
          removedCount++;
          console.log(`🗑️ Backup removido: ${backup.backup_id}`);
        } catch (error) {
          console.warn(`⚠️ Falha ao remover backup ${backup.backup_id}:`, error.message);
        }
      }

      console.log(`✅ Cleanup concluído: ${removedCount} backups removidos, ${backups.length - removedCount} mantidos`);
      
      return { 
        removed: removedCount, 
        kept: backups.length - removedCount 
      };

    } catch (error) {
      console.error('❌ Erro na limpeza de backups:', error);
      return { removed: 0, kept: 0, error: error.message };
    }
  }

  /**
   * Calcula tamanho do backup
   */
  async calculateBackupSize(backupDir) {
    try {
      const isWindows = process.platform === 'win32';
      
      if (isWindows) {
        const { stdout } = await execAsync(
          `powershell "Get-ChildItem -Path '${backupDir}' -Recurse | Measure-Object -Property Length -Sum | Select-Object Sum"`,
          { timeout: 30000 }
        );
        
        const sizeMatch = stdout.match(/(\d+)/);
        const sizeBytes = sizeMatch ? parseInt(sizeMatch[1]) : 0;
        return Math.round(sizeBytes / (1024 * 1024)); // MB
      } else {
        const { stdout } = await execAsync(`du -sm "${backupDir}" | cut -f1`, { timeout: 30000 });
        return parseInt(stdout.trim()) || 0;
      }
    } catch (error) {
      console.warn('⚠️ Não foi possível calcular tamanho do backup:', error.message);
      return 0;
    }
  }

  /**
   * Calcula tamanho de um diretório
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

  /**
   * Verifica integridade de um backup
   */
  async verifyBackup(backupId) {
    try {
      const backupDir = path.join(this.backupBaseDir, backupId);
      const manifestPath = path.join(backupDir, 'backup-manifest.json');
      
      if (!await fs.pathExists(manifestPath)) {
        return { valid: false, error: 'Manifest not found' };
      }

      const manifest = await fs.readJSON(manifestPath);
      const checks = {
        manifest: true,
        instance_config: false,
        environment_files: false,
        volumes: false,
        container_state: false
      };

      // Verificar cada componente
      if (manifest.components.instance_config?.success) {
        checks.instance_config = await fs.pathExists(path.join(backupDir, 'instance-config.json'));
      }

      if (manifest.components.environment_files?.success) {
        checks.environment_files = await fs.pathExists(path.join(backupDir, 'environment.env'));
      }

      if (manifest.components.volumes?.success) {
        checks.volumes = await fs.pathExists(path.join(backupDir, 'volumes'));
      }

      if (manifest.components.container_state?.success) {
        checks.container_state = await fs.pathExists(path.join(backupDir, 'container-states.json'));
      }

      const validComponents = Object.values(checks).filter(Boolean).length;
      const totalComponents = Object.keys(checks).length;
      
      return {
        valid: validComponents >= totalComponents * 0.8, // 80% dos componentes devem estar válidos
        checks: checks,
        manifest: manifest,
        completeness: `${validComponents}/${totalComponents}`
      };

    } catch (error) {
      return { 
        valid: false, 
        error: error.message 
      };
    }
  }
}

module.exports = BackupManager;