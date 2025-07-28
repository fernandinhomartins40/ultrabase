/**
 * BACKUP SYSTEM - Sistema de backup automático e seguro
 * 
 * Gerencia backups antes de operações críticas:
 * - Backup de configurações de instância
 * - Snapshot de estado atual
 * - Verificação de integridade
 * - Sistema de versionamento
 */

const fs = require('fs-extra');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { execAsync } = require('util').promisify(require('child_process').exec);

class BackupSystem {
  constructor(config) {
    this.config = config;
    this.backupDir = path.join(config.DOCKER_DIR, '..', 'backups');
    this.maxBackupsPerInstance = 10; // Manter últimos 10 backups por instância
    this.initializeBackupDirectory();
  }

  /**
   * Inicializa diretório de backups
   */
  async initializeBackupDirectory() {
    try {
      await fs.ensureDir(this.backupDir);
      console.log(`📁 Diretório de backup inicializado: ${this.backupDir}`);
    } catch (error) {
      console.error('❌ Erro ao inicializar diretório de backup:', error);
      throw error;
    }
  }

  /**
   * Cria backup completo de uma instância antes de operações críticas
   */
  async createInstanceBackup(instanceId, operation = 'unknown') {
    try {
      console.log(`💾 Criando backup da instância ${instanceId} para operação: ${operation}`);
      
      const backupId = `${instanceId}_${Date.now()}_${uuidv4().substring(0, 8)}`;
      const instanceBackupDir = path.join(this.backupDir, instanceId);
      const backupPath = path.join(instanceBackupDir, backupId);

      // Criar diretório do backup
      await fs.ensureDir(backupPath);

      const backup = {
        backup_id: backupId,
        instance_id: instanceId,
        operation: operation,
        timestamp: new Date().toISOString(),
        backup_path: backupPath,
        files: {},
        integrity_check: null
      };

      // 1. Backup dos arquivos de configuração
      await this.backupConfigurationFiles(instanceId, backupPath, backup);

      // 2. Backup do estado da instância (instances.json)
      await this.backupInstanceState(instanceId, backupPath, backup);

      // 3. Verificação de integridade dos volumes (sem copiar dados)
      await this.verifyVolumeIntegrity(instanceId, backup);

      // 4. Snapshot do estado dos containers
      await this.captureContainerSnapshot(instanceId, backupPath, backup);

      // 5. Salvar metadata do backup
      const metadataFile = path.join(backupPath, 'backup-metadata.json');
      await fs.writeFile(metadataFile, JSON.stringify(backup, null, 2));

      // 6. Limpar backups antigos
      await this.cleanupOldBackups(instanceId);

      console.log(`✅ Backup criado com sucesso: ${backupId}`);
      return backup;

    } catch (error) {
      console.error(`❌ Erro ao criar backup da instância ${instanceId}:`, error);
      throw new Error(`Falha no backup: ${error.message}`);
    }
  }

  /**
   * Backup dos arquivos de configuração (.env, docker-compose.yml)
   */
  async backupConfigurationFiles(instanceId, backupPath, backup) {
    try {
      const configDir = path.join(backupPath, 'config');
      await fs.ensureDir(configDir);

      const filesToBackup = [
        `.env-${instanceId}`,
        `docker-compose-${instanceId}.yml`
      ];

      backup.files.configuration = [];

      for (const filename of filesToBackup) {
        const sourcePath = path.join(this.config.DOCKER_DIR, filename);
        const destPath = path.join(configDir, filename);

        if (await fs.pathExists(sourcePath)) {
          await fs.copy(sourcePath, destPath);
          
          // Verificar integridade do arquivo copiado
          const sourceStats = await fs.stat(sourcePath);
          const destStats = await fs.stat(destPath);
          
          backup.files.configuration.push({
            filename: filename,
            source_path: sourcePath,
            backup_path: destPath,
            size_bytes: sourceStats.size,
            integrity_verified: sourceStats.size === destStats.size,
            last_modified: sourceStats.mtime.toISOString()
          });

          console.log(`📄 Backup do arquivo de configuração: ${filename}`);
        } else {
          console.warn(`⚠️ Arquivo não encontrado para backup: ${filename}`);
        }
      }

    } catch (error) {
      throw new Error(`Erro no backup de configurações: ${error.message}`);
    }
  }

  /**
   * Backup do estado da instância (entrada no instances.json)
   */
  async backupInstanceState(instanceId, backupPath, backup) {
    try {
      const instancesFile = path.join(this.config.DOCKER_DIR, '..', 'src', 'instances.json');
      
      if (await fs.pathExists(instancesFile)) {
        const instancesData = await fs.readJson(instancesFile);
        
        if (instancesData[instanceId]) {
          const instanceStatePath = path.join(backupPath, 'instance-state.json');
          const instanceState = {
            instance_data: instancesData[instanceId],
            backup_timestamp: new Date().toISOString(),
            full_instances_file_backup: instancesData // Backup completo para contexto
          };

          await fs.writeFile(instanceStatePath, JSON.stringify(instanceState, null, 2));
          
          backup.files.instance_state = {
            backup_path: instanceStatePath,
            instance_exists: true,
            last_updated: instancesData[instanceId].updated_at
          };

          console.log(`📊 Backup do estado da instância salvo`);
        } else {
          console.warn(`⚠️ Instância ${instanceId} não encontrada no instances.json`);
          backup.files.instance_state = {
            instance_exists: false,
            warning: 'Instance not found in instances.json'
          };
        }
      }

    } catch (error) {
      throw new Error(`Erro no backup de estado: ${error.message}`);
    }
  }

  /**
   * Verifica integridade dos volumes sem copiá-los (muito grandes)
   */
  async verifyVolumeIntegrity(instanceId, backup) {
    try {
      const volumePath = path.join(this.config.DOCKER_DIR, `volumes-${instanceId}`);
      
      if (await fs.pathExists(volumePath)) {
        const integrityCheck = {
          volume_path: volumePath,
          exists: true,
          directories: {},
          total_size_estimate: null
        };

        // Verificar diretórios críticos
        const criticalDirs = ['db', 'storage', 'logs', 'api'];
        
        for (const dir of criticalDirs) {
          const dirPath = path.join(volumePath, dir);
          const dirExists = await fs.pathExists(dirPath);
          
          integrityCheck.directories[dir] = {
            exists: dirExists,
            path: dirPath
          };

          if (dirExists) {
            // Contar arquivos no diretório (sem ler conteúdo)
            try {
              const files = await fs.readdir(dirPath);
              integrityCheck.directories[dir].file_count = files.length;
            } catch (dirError) {
              integrityCheck.directories[dir].error = dirError.message;
            }
          }
        }

        // Estimar tamanho total (apenas no Windows via PowerShell, no Linux via du)
        try {
          const isWindows = process.platform === 'win32';
          
          if (isWindows) {
            const { stdout } = await execAsync(
              `powershell "Get-ChildItem -Path '${volumePath}' -Recurse | Measure-Object -Property Length -Sum | Select-Object Sum"`,
              { timeout: 30000 }
            );
            const sizeMatch = stdout.match(/(\d+)/);
            if (sizeMatch) {
              integrityCheck.total_size_estimate = parseInt(sizeMatch[1]);
            }
          } else {
            const { stdout } = await execAsync(`du -sb "${volumePath}"`, { timeout: 30000 });
            integrityCheck.total_size_estimate = parseInt(stdout.split('\t')[0]);
          }
        } catch (sizeError) {
          console.warn('⚠️ Não foi possível calcular tamanho dos volumes:', sizeError.message);
          integrityCheck.size_calculation_error = sizeError.message;
        }

        backup.integrity_check = integrityCheck;
        console.log(`🔍 Verificação de integridade dos volumes concluída`);

      } else {
        backup.integrity_check = {
          volume_path: volumePath,
          exists: false,
          error: 'Volume directory not found'
        };
        console.warn(`⚠️ Diretório de volumes não encontrado: ${volumePath}`);
      }

    } catch (error) {
      backup.integrity_check = {
        error: error.message,
        verification_failed: true
      };
      console.error(`❌ Erro na verificação de integridade:`, error);
    }
  }

  /**
   * Captura snapshot do estado atual dos containers
   */
  async captureContainerSnapshot(instanceId, backupPath, backup) {
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

      const containerSnapshot = {
        timestamp: new Date().toISOString(),
        containers: {}
      };

      for (const containerName of containerNames) {
        try {
          const containers = await docker.listContainers({
            all: true,
            filters: { name: [containerName] }
          });

          if (containers.length > 0) {
            const container = containers[0];
            containerSnapshot.containers[containerName] = {
              id: container.Id,
              state: container.State,
              status: container.Status,
              image: container.Image,
              created: new Date(container.Created * 1000).toISOString(),
              ports: container.Ports,
              mounts: container.Mounts?.map(mount => ({
                source: mount.Source,
                destination: mount.Destination,
                mode: mount.Mode,
                type: mount.Type
              })) || []
            };
          } else {
            containerSnapshot.containers[containerName] = {
              exists: false,
              status: 'not_found'
            };
          }
        } catch (containerError) {
          containerSnapshot.containers[containerName] = {
            error: containerError.message,
            status: 'error'
          };
        }
      }

      const snapshotFile = path.join(backupPath, 'container-snapshot.json');
      await fs.writeFile(snapshotFile, JSON.stringify(containerSnapshot, null, 2));

      backup.files.container_snapshot = {
        backup_path: snapshotFile,
        containers_captured: Object.keys(containerSnapshot.containers).length
      };

      console.log(`📸 Snapshot dos containers capturado`);

    } catch (error) {
      console.error(`❌ Erro ao capturar snapshot de containers:`, error);
      backup.files.container_snapshot = {
        error: error.message,
        snapshot_failed: true
      };
    }
  }

  /**
   * Restaura uma instância a partir de um backup
   */
  async restoreInstanceFromBackup(instanceId, backupId) {
    try {
      console.log(`🔄 Iniciando restauração da instância ${instanceId} do backup ${backupId}`);
      
      const backupPath = path.join(this.backupDir, instanceId, backupId);
      const metadataFile = path.join(backupPath, 'backup-metadata.json');

      if (!await fs.pathExists(metadataFile)) {
        throw new Error(`Backup ${backupId} não encontrado ou inválido`);
      }

      const backup = await fs.readJson(metadataFile);
      
      // 1. Verificar integridade do backup antes de restaurar
      await this.verifyBackupIntegrity(backup);

      // 2. Restaurar arquivos de configuração
      await this.restoreConfigurationFiles(backup);

      // 3. Restaurar estado da instância
      await this.restoreInstanceState(backup);

      console.log(`✅ Restauração do backup ${backupId} concluída com sucesso`);
      return backup;

    } catch (error) {
      console.error(`❌ Erro na restauração do backup:`, error);
      throw new Error(`Falha na restauração: ${error.message}`);
    }
  }

  /**
   * Verifica integridade de um backup antes de usá-lo
   */
  async verifyBackupIntegrity(backup) {
    try {
      console.log(`🔍 Verificando integridade do backup ${backup.backup_id}`);

      // Verificar se arquivos de backup existem
      if (backup.files.configuration) {
        for (const fileInfo of backup.files.configuration) {
          if (!await fs.pathExists(fileInfo.backup_path)) {
            throw new Error(`Arquivo de backup não encontrado: ${fileInfo.filename}`);
          }

          // Verificar tamanho do arquivo
          const stats = await fs.stat(fileInfo.backup_path);
          if (stats.size !== fileInfo.size_bytes) {
            throw new Error(`Arquivo de backup corrompido: ${fileInfo.filename}`);
          }
        }
      }

      // Verificar metadata
      if (!backup.files.instance_state) {
        throw new Error('Estado da instância não encontrado no backup');
      }

      console.log(`✅ Integridade do backup verificada`);

    } catch (error) {
      throw new Error(`Backup corrompido: ${error.message}`);
    }
  }

  /**
   * Restaura arquivos de configuração de um backup
   */
  async restoreConfigurationFiles(backup) {
    try {
      console.log(`📄 Restaurando arquivos de configuração`);

      if (backup.files.configuration) {
        for (const fileInfo of backup.files.configuration) {
          // Fazer backup do arquivo atual antes de substituir
          const currentFile = fileInfo.source_path;
          if (await fs.pathExists(currentFile)) {
            const backupCurrentFile = `${currentFile}.before-restore-${Date.now()}`;
            await fs.copy(currentFile, backupCurrentFile);
            console.log(`💾 Backup do arquivo atual criado: ${path.basename(backupCurrentFile)}`);
          }

          // Restaurar arquivo do backup
          await fs.copy(fileInfo.backup_path, fileInfo.source_path);
          console.log(`📄 Arquivo restaurado: ${fileInfo.filename}`);
        }
      }

    } catch (error) {
      throw new Error(`Erro ao restaurar configurações: ${error.message}`);
    }
  }

  /**
   * Restaura estado da instância no instances.json
   */
  async restoreInstanceState(backup) {
    try {
      console.log(`📊 Restaurando estado da instância`);

      const instanceStatePath = path.join(backup.backup_path, 'instance-state.json');
      if (await fs.pathExists(instanceStatePath)) {
        const instanceState = await fs.readJson(instanceStatePath);
        
        const instancesFile = path.join(this.config.DOCKER_DIR, '..', 'src', 'instances.json');
        
        // Fazer backup do instances.json atual
        if (await fs.pathExists(instancesFile)) {
          const backupInstancesFile = `${instancesFile}.before-restore-${Date.now()}`;
          await fs.copy(instancesFile, backupInstancesFile);
          console.log(`💾 Backup do instances.json atual criado`);
        }

        // Restaurar entrada da instância
        const currentInstances = await fs.pathExists(instancesFile) ? await fs.readJson(instancesFile) : {};
        currentInstances[backup.instance_id] = instanceState.instance_data;
        
        await fs.writeFile(instancesFile, JSON.stringify(currentInstances, null, 2));
        console.log(`📊 Estado da instância restaurado no instances.json`);
      }

    } catch (error) {
      throw new Error(`Erro ao restaurar estado: ${error.message}`);
    }
  }

  /**
   * Lista backups disponíveis para uma instância
   */
  async listInstanceBackups(instanceId) {
    try {
      const instanceBackupDir = path.join(this.backupDir, instanceId);
      
      if (!await fs.pathExists(instanceBackupDir)) {
        return [];
      }

      const backupFolders = await fs.readdir(instanceBackupDir);
      const backups = [];

      for (const folder of backupFolders) {
        const metadataFile = path.join(instanceBackupDir, folder, 'backup-metadata.json');
        
        if (await fs.pathExists(metadataFile)) {
          try {
            const metadata = await fs.readJson(metadataFile);
            backups.push({
              backup_id: metadata.backup_id,
              timestamp: metadata.timestamp,
              operation: metadata.operation,
              files_backed_up: Object.keys(metadata.files).length,
              integrity_verified: !!metadata.integrity_check && !metadata.integrity_check.error
            });
          } catch (metadataError) {
            console.warn(`⚠️ Erro ao ler metadata do backup ${folder}:`, metadataError.message);
          }
        }
      }

      // Ordenar por data (mais recente primeiro)
      backups.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      
      return backups;

    } catch (error) {
      console.error(`❌ Erro ao listar backups:`, error);
      return [];
    }
  }

  /**
   * Remove backups antigos mantendo apenas os N mais recentes
   */
  async cleanupOldBackups(instanceId) {
    try {
      const backups = await this.listInstanceBackups(instanceId);
      
      if (backups.length > this.maxBackupsPerInstance) {
        const backupsToDelete = backups.slice(this.maxBackupsPerInstance);
        
        for (const backup of backupsToDelete) {
          const backupPath = path.join(this.backupDir, instanceId, backup.backup_id);
          
          if (await fs.pathExists(backupPath)) {
            await fs.remove(backupPath);
            console.log(`🗑️ Backup antigo removido: ${backup.backup_id}`);
          }
        }
        
        console.log(`🧹 Limpeza concluída: ${backupsToDelete.length} backups antigos removidos`);
      }

    } catch (error) {
      console.warn(`⚠️ Erro na limpeza de backups antigos:`, error.message);
    }
  }

  /**
   * Obtém informações detalhadas de um backup específico
   */
  async getBackupDetails(instanceId, backupId) {
    try {
      const metadataFile = path.join(this.backupDir, instanceId, backupId, 'backup-metadata.json');
      
      if (!await fs.pathExists(metadataFile)) {
        throw new Error(`Backup ${backupId} não encontrado`);
      }

      return await fs.readJson(metadataFile);

    } catch (error) {
      throw new Error(`Erro ao obter detalhes do backup: ${error.message}`);
    }
  }
}

module.exports = BackupSystem;