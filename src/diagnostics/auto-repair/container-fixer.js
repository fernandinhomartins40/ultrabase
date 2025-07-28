/**
 * CONTAINER FIXER - Correções específicas de containers Docker
 * 
 * Responsável por corrigir problemas relacionados a containers das instâncias.
 */

const { execAsync } = require('util').promisify(require('child_process').exec);
const Docker = require('dockerode');

class ContainerFixer {
  constructor(config) {
    this.config = config;
    this.docker = new Docker();
    
    // Lista de containers por instância
    this.containerTypes = [
      'supabase-studio',
      'supabase-kong', 
      'supabase-auth',
      'supabase-rest',
      'supabase-db',
      'supabase-storage',
      'realtime-dev.supabase-realtime'
    ];
  }

  /**
   * Corrige containers parados de uma instância
   */
  async fixStoppedContainers(instanceId, parameters) {
    try {
      console.log(`🐳 Corrigindo containers parados da instância ${instanceId}`);
      
      const instance = this.getInstanceConfig(instanceId);
      const results = {
        containers_checked: 0,
        containers_started: 0,
        containers_failed: 0,
        actions_taken: []
      };

      // 1. Identificar containers parados
      const containerStatuses = await this.getContainerStatuses(instanceId);
      const stoppedContainers = Object.entries(containerStatuses)
        .filter(([name, status]) => !status.running)
        .map(([name, status]) => ({ name, status }));

      console.log(`🔍 Encontrados ${stoppedContainers.length} containers parados`);
      results.containers_checked = Object.keys(containerStatuses).length;

      if (stoppedContainers.length === 0) {
        return {
          success: true,
          message: 'Todos os containers já estão rodando',
          details: results
        };
      }

      // 2. Tentar restart individual primeiro
      for (const container of stoppedContainers) {
        try {
          console.log(`🔄 Tentando reiniciar container ${container.name}`);
          
          await this.restartContainer(container.name);
          await this.waitForContainerReady(container.name);
          
          results.containers_started++;
          results.actions_taken.push(`Reiniciado: ${container.name}`);
          
          // Pausa entre restarts
          await new Promise(resolve => setTimeout(resolve, 3000));
          
        } catch (containerError) {
          console.warn(`⚠️ Falha ao reiniciar ${container.name}:`, containerError.message);
          results.containers_failed++;
          results.actions_taken.push(`Falha: ${container.name} - ${containerError.message}`);
        }
      }

      // 3. Se muitos containers falharam, tentar restart completo
      if (results.containers_failed > results.containers_started) {
        console.log(`🔄 Tentando restart completo da instância (muitas falhas individuais)`);
        
        try {
          await this.restartAllContainers(instanceId, instance);
          results.actions_taken.push('Restart completo executado');
          
          // Verificar resultado
          const finalStatuses = await this.getContainerStatuses(instanceId);
          const finalRunning = Object.values(finalStatuses).filter(status => status.running).length;
          
          results.containers_started = finalRunning;
          
        } catch (fullRestartError) {
          console.error(`❌ Falha no restart completo:`, fullRestartError.message);
          throw new Error(`Restart individual e completo falharam: ${fullRestartError.message}`);
        }
      }

      // 4. Verificar resultado final
      if (results.containers_started > 0) {
        console.log(`✅ ${results.containers_started} containers iniciados com sucesso`);
        return {
          success: true,
          message: `${results.containers_started} containers corrigidos`,
          details: results
        };
      } else {
        throw new Error('Nenhum container pôde ser iniciado');
      }

    } catch (error) {
      console.error(`❌ Erro na correção de containers:`, error);
      throw new Error(`Falha na correção de containers: ${error.message}`);
    }
  }

  /**
   * Reinicia especificamente o container de database
   */
  async restartDatabaseContainer(instanceId, parameters) {
    try {
      console.log(`🗄️ Reiniciando container de database da instância ${instanceId}`);
      
      const dbContainerName = `supabase-db-${instanceId}`;
      
      // 1. Verificar se container existe
      const containerExists = await this.containerExists(dbContainerName);
      if (!containerExists) {
        throw new Error(`Container de database ${dbContainerName} não encontrado`);
      }

      // 2. Parar container gracefully
      console.log(`⏸️ Parando container ${dbContainerName}...`);
      await this.stopContainer(dbContainerName, 30000); // 30s timeout

      // 3. Aguardar alguns segundos
      await new Promise(resolve => setTimeout(resolve, 5000));

      // 4. Iniciar container
      console.log(`🚀 Iniciando container ${dbContainerName}...`);
      await this.startContainer(dbContainerName);

      // 5. Aguardar database ficar pronto
      console.log(`⏳ Aguardando database ficar pronto...`);
      await this.waitForDatabaseReady(instanceId, 60000); // 60s timeout

      return {
        success: true,
        message: 'Container de database reiniciado com sucesso',
        container: dbContainerName
      };

    } catch (error) {
      console.error(`❌ Erro ao reiniciar database:`, error);
      throw new Error(`Falha no restart do database: ${error.message}`);
    }
  }

  /**
   * Obtém status de todos os containers da instância
   */
  async getContainerStatuses(instanceId) {
    const statuses = {};

    for (const containerType of this.containerTypes) {
      const containerName = `${containerType}-${instanceId}`;
      
      try {
        const containers = await this.docker.listContainers({
          all: true,
          filters: { name: [containerName] }
        });

        if (containers.length > 0) {
          const container = containers[0];
          statuses[containerName] = {
            running: container.State === 'running',
            status: container.Status,
            state: container.State,
            created: new Date(container.Created * 1000)
          };
        } else {
          statuses[containerName] = {
            running: false,
            status: 'not_found',
            state: 'missing',
            created: null
          };
        }
      } catch (error) {
        statuses[containerName] = {
          running: false,
          status: 'error',
          state: 'error',
          error: error.message,
          created: null
        };
      }
    }

    return statuses;
  }

  /**
   * Reinicia todos os containers da instância usando docker-compose
   */
  async restartAllContainers(instanceId, instance) {
    try {
      const dockerDir = this.config.DOCKER_DIR;
      const composeFile = instance.docker.compose_file;
      const envFile = instance.docker.env_file;

      console.log(`🔄 Executando restart completo via docker-compose...`);

      // 1. Parar todos os containers
      const stopCommand = `cd "${dockerDir}" && docker compose -f "${composeFile}" stop`;
      await execAsync(stopCommand, { timeout: 60000 });

      // Aguardar parada completa
      await new Promise(resolve => setTimeout(resolve, 10000));

      // 2. Iniciar todos os containers
      const startCommand = `cd "${dockerDir}" && docker compose -f "${composeFile}" --env-file "${envFile}" up -d`;
      await execAsync(startCommand, { timeout: 120000 });

      // 3. Aguardar containers ficarem prontos
      await this.waitForAllContainersReady(instanceId, 120000);

      console.log(`✅ Restart completo executado com sucesso`);

    } catch (error) {
      throw new Error(`Falha no restart completo: ${error.message}`);
    }
  }

  /**
   * Reinicia um container específico
   */
  async restartContainer(containerName) {
    try {
      const container = this.docker.getContainer(containerName);
      
      // Tentar restart graceful primeiro
      await container.restart({ t: 30 }); // 30s timeout
      
    } catch (error) {
      // Se restart falhar, tentar stop + start
      try {
        await this.stopContainer(containerName, 15000);
        await new Promise(resolve => setTimeout(resolve, 3000));
        await this.startContainer(containerName);
      } catch (fallbackError) {
        throw new Error(`Restart de ${containerName} falhou: ${error.message}`);
      }
    }
  }

  /**
   * Para um container específico
   */
  async stopContainer(containerName, timeout = 30000) {
    try {
      const container = this.docker.getContainer(containerName);
      await container.stop({ t: Math.floor(timeout / 1000) });
    } catch (error) {
      if (!error.message.includes('is not running')) {
        throw error;
      }
    }
  }

  /**
   * Inicia um container específico
   */
  async startContainer(containerName) {
    try {
      const container = this.docker.getContainer(containerName);
      await container.start();
    } catch (error) {
      if (!error.message.includes('already started')) {
        throw error;
      }
    }
  }

  /**
   * Verifica se container existe
   */
  async containerExists(containerName) {
    try {
      const containers = await this.docker.listContainers({
        all: true,
        filters: { name: [containerName] }
      });
      return containers.length > 0;
    } catch (error) {
      return false;
    }
  }

  /**
   * Aguarda container ficar pronto
   */
  async waitForContainerReady(containerName, timeout = 60000) {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeout) {
      try {
        const container = this.docker.getContainer(containerName);
        const info = await container.inspect();
        
        if (info.State.Running && info.State.Health?.Status === 'healthy') {
          return true;
        }
        
        if (info.State.Running) {
          // Se não tem health check, considerar pronto após estar rodando por 10s
          if (Date.now() - new Date(info.State.StartedAt).getTime() > 10000) {
            return true;
          }
        }
        
      } catch (error) {
        // Container ainda não está pronto
      }
      
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    throw new Error(`Container ${containerName} não ficou pronto em ${timeout}ms`);
  }

  /**
   * Aguarda todos os containers ficarem prontos
   */
  async waitForAllContainersReady(instanceId, timeout = 120000) {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeout) {
      const statuses = await this.getContainerStatuses(instanceId);
      const runningContainers = Object.values(statuses).filter(status => status.running).length;
      const totalContainers = Object.keys(statuses).length;
      
      console.log(`⏳ Containers prontos: ${runningContainers}/${totalContainers}`);
      
      if (runningContainers >= totalContainers * 0.8) { // 80% dos containers rodando
        console.log(`✅ Containers estão prontos`);
        return true;
      }
      
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
    
    throw new Error(`Containers não ficaram prontos em ${timeout}ms`);
  }

  /**
   * Aguarda database específico ficar pronto
   */
  async waitForDatabaseReady(instanceId, timeout = 60000) {
    const startTime = Date.now();
    const instance = this.getInstanceConfig(instanceId);
    
    while (Date.now() - startTime < timeout) {
      try {
        // Tentar conexão simples com database
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
        
        console.log(`✅ Database está pronto`);
        return true;
        
      } catch (error) {
        // Database ainda não está pronto
      }
      
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
    
    throw new Error(`Database não ficou pronto em ${timeout}ms`);
  }

  /**
   * Obtém configuração da instância
   */
  getInstanceConfig(instanceId) {
    // Esta função deveria acessar o instanceManager
    // Por simplicidade, vamos assumir que será injetada
    const instanceManager = require('../../management/instance-manager');
    return instanceManager.instances[instanceId];
  }
}

module.exports = ContainerFixer;