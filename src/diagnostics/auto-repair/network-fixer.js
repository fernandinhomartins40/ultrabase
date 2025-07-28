/**
 * NETWORK FIXER - Correções de conectividade de rede
 * 
 * Responsável por corrigir problemas de conectividade das instâncias.
 */

const { execAsync } = require('util').promisify(require('child_process').exec);
const net = require('net');

class NetworkFixer {
  constructor(config) {
    this.config = config;
  }

  /**
   * Corrige problemas de conectividade de rede
   */
  async fixConnectivity(instanceId, parameters) {
    try {
      console.log(`🌐 Corrigindo conectividade da instância ${instanceId}`);
      
      const instance = this.getInstanceConfig(instanceId);
      const results = {
        ports_checked: 0,
        ports_fixed: 0,
        actions_taken: []
      };

      // 1. Identificar portas com problema
      const problematicPorts = this.extractProblematicPorts(parameters);
      results.ports_checked = problematicPorts.length;

      console.log(`🔍 Verificando ${problematicPorts.length} portas com problemas`);

      // 2. Corrigir cada porta
      for (const portInfo of problematicPorts) {
        try {
          console.log(`🔧 Corrigindo porta ${portInfo.port} (${portInfo.name})`);
          
          const fixed = await this.fixPort(instanceId, instance, portInfo);
          
          if (fixed) {
            results.ports_fixed++;
            results.actions_taken.push(`Porta ${portInfo.port} corrigida`);
          }
          
        } catch (portError) {
          console.warn(`⚠️ Falha ao corrigir porta ${portInfo.port}:`, portError.message);
          results.actions_taken.push(`Falha na porta ${portInfo.port}: ${portError.message}`);
        }
      }

      // 3. Verificar resultado
      if (results.ports_fixed > 0) {
        console.log(`✅ ${results.ports_fixed} portas corrigidas`);
        return {
          success: true,
          message: `${results.ports_fixed} portas de rede corrigidas`,
          details: results
        };
      } else {
        throw new Error('Nenhuma porta pôde ser corrigida');
      }

    } catch (error) {
      console.error(`❌ Erro na correção de rede:`, error);
      throw new Error(`Falha na correção de rede: ${error.message}`);
    }
  }

  /**
   * Extrai portas problemáticas dos parâmetros
   */
  extractProblematicPorts(parameters) {
    const ports = [];
    
    if (parameters.tests) {
      Object.entries(parameters.tests).forEach(([name, test]) => {
        if (test.port && !test.accessible) {
          ports.push({
            name: name,
            port: test.port,
            error: test.error
          });
        }
      });
    }

    if (parameters.issues) {
      parameters.issues.forEach(issue => {
        // Extrair porta da mensagem de erro
        const portMatch = issue.match(/porta (\d+)/i);
        if (portMatch) {
          const port = parseInt(portMatch[1]);
          if (!ports.find(p => p.port === port)) {
            ports.push({
              name: 'unknown',
              port: port,
              error: issue
            });
          }
        }
      });
    }

    return ports;
  }

  /**
   * Corrige uma porta específica
   */
  async fixPort(instanceId, instance, portInfo) {
    try {
      // 1. Verificar se porta está realmente inacessível
      const isAccessible = await this.testPortAccessibility(portInfo.port);
      
      if (isAccessible) {
        console.log(`✅ Porta ${portInfo.port} já está acessível`);
        return true;
      }

      // 2. Verificar se processo está usando a porta
      const processInfo = await this.getPortProcess(portInfo.port);
      
      if (!processInfo) {
        // Porta não está sendo usada - problema pode ser de container
        console.log(`🔄 Porta ${portInfo.port} não está em uso, reiniciando container responsável`);
        await this.restartPortContainer(instanceId, portInfo);
        
        // Aguardar e verificar novamente
        await new Promise(resolve => setTimeout(resolve, 10000));
        return await this.testPortAccessibility(portInfo.port);
      }

      // 3. Se processo está rodando mas porta inacessível, pode ser firewall
      console.log(`🔥 Verificando firewall para porta ${portInfo.port}`);
      await this.checkFirewallRules(portInfo.port);

      // 4. Testar novamente
      await new Promise(resolve => setTimeout(resolve, 5000));
      return await this.testPortAccessibility(portInfo.port);

    } catch (error) {
      console.error(`❌ Erro ao corrigir porta ${portInfo.port}:`, error);
      return false;
    }
  }

  /**
   * Testa acessibilidade de uma porta
   */
  async testPortAccessibility(port, timeout = 5000) {
    return new Promise((resolve) => {
      const socket = new net.Socket();
      let resolved = false;
      
      const resolveOnce = (result) => {
        if (!resolved) {
          resolved = true;
          resolve(result);
        }
      };

      const timeoutHandle = setTimeout(() => {
        socket.destroy();
        resolveOnce(false);
      }, timeout);

      socket.connect(port, 'localhost', () => {
        clearTimeout(timeoutHandle);
        socket.destroy();
        resolveOnce(true);
      });

      socket.on('error', () => {
        clearTimeout(timeoutHandle);
        resolveOnce(false);
      });
    });
  }

  /**
   * Obtém processo que está usando uma porta
   */
  async getPortProcess(port) {
    try {
      const isWindows = process.platform === 'win32';
      
      if (isWindows) {
        const { stdout } = await execAsync(`netstat -ano | findstr :${port}`, { timeout: 10000 });
        
        if (stdout.trim()) {
          const lines = stdout.trim().split('\n');
          const processMatch = lines[0].match(/\s+(\d+)$/);
          return processMatch ? { pid: processMatch[1] } : null;
        }
      } else {
        const { stdout } = await execAsync(`lsof -i :${port}`, { timeout: 10000 });
        
        if (stdout.trim()) {
          const lines = stdout.trim().split('\n');
          if (lines.length > 1) {
            const parts = lines[1].split(/\s+/);
            return { pid: parts[1], command: parts[0] };
          }
        }
      }
      
      return null;
      
    } catch (error) {
      return null;
    }
  }

  /**
   * Reinicia container responsável por uma porta
   */
  async restartPortContainer(instanceId, portInfo) {
    try {
      const instance = this.getInstanceConfig(instanceId);
      
      // Mapear porta para container
      const containerName = this.getContainerForPort(instanceId, portInfo.port, instance);
      
      if (containerName) {
        console.log(`🔄 Reiniciando container ${containerName} para porta ${portInfo.port}`);
        
        await execAsync(`docker restart ${containerName}`, { timeout: 60000 });
        
        // Aguardar container ficar pronto
        await new Promise(resolve => setTimeout(resolve, 15000));
        
        console.log(`✅ Container ${containerName} reiniciado`);
      } else {
        console.warn(`⚠️ Container não identificado para porta ${portInfo.port}`);
      }
      
    } catch (error) {
      throw new Error(`Falha ao reiniciar container para porta ${portInfo.port}: ${error.message}`);
    }
  }

  /**
   * Identifica container responsável por uma porta
   */
  getContainerForPort(instanceId, port, instance) {
    // Mapear portas conhecidas para containers
    const portMapping = {
      [instance.ports.kong_http]: `supabase-kong-${instanceId}`,
      [instance.ports.postgres_ext]: `supabase-db-${instanceId}`,
      [instance.ports.analytics]: `supabase-analytics-${instanceId}`
    };

    return portMapping[port] || null;
  }

  /**
   * Verifica regras de firewall
   */
  async checkFirewallRules(port) {
    try {
      const isWindows = process.platform === 'win32';
      
      if (isWindows) {
        // Verificar Windows Firewall
        try {
          const { stdout } = await execAsync(
            `netsh advfirewall firewall show rule name=all | findstr ${port}`,
            { timeout: 10000 }
          );
          
          if (!stdout.trim()) {
            console.log(`🔥 Adicionando regra de firewall para porta ${port}`);
            await execAsync(
              `netsh advfirewall firewall add rule name="Supabase Port ${port}" dir=in action=allow protocol=TCP localport=${port}`,
              { timeout: 10000 }
            );
          }
        } catch (firewallError) {
          console.warn(`⚠️ Erro ao configurar firewall:`, firewallError.message);
        }
      } else {
        // Verificar iptables/ufw no Linux
        try {
          const { stdout } = await execAsync(`ufw status | grep ${port}`, { timeout: 10000 });
          
          if (!stdout.trim()) {
            console.log(`🔥 Adicionando regra ufw para porta ${port}`);
            await execAsync(`ufw allow ${port}`, { timeout: 10000 });
          }
        } catch (ufwError) {
          console.warn(`⚠️ Erro ao configurar ufw:`, ufwError.message);
        }
      }
      
    } catch (error) {
      console.warn(`⚠️ Erro na verificação de firewall:`, error.message);
    }
  }

  /**
   * Obtém configuração da instância
   */
  getInstanceConfig(instanceId) {
    const instanceManager = require('../../management/instance-manager');
    return instanceManager.instances[instanceId];
  }
}

module.exports = NetworkFixer;