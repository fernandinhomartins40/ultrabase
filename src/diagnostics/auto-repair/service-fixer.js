/**
 * SERVICE FIXER - Correções específicas de serviços HTTP
 * 
 * Responsável por corrigir problemas de serviços como Auth, REST API, etc.
 */

const { execAsync } = require('util').promisify(require('child_process').exec);
const fetch = require('node-fetch');

class ServiceFixer {
  constructor(config) {
    this.config = config;
  }

  /**
   * Reinicia serviço de autenticação (GoTrue)
   */
  async restartAuthService(instanceId, parameters) {
    try {
      console.log(`🔐 Reiniciando serviço de autenticação da instância ${instanceId}`);
      
      const results = {
        containers_restarted: [],
        tests_performed: [],
        success: false
      };

      // 1. Reiniciar container de auth
      const authContainer = `supabase-auth-${instanceId}`;
      
      try {
        console.log(`🔄 Reiniciando container ${authContainer}...`);
        await execAsync(`docker restart ${authContainer}`, { timeout: 60000 });
        results.containers_restarted.push(authContainer);
        
        // Aguardar auth ficar pronto
        await new Promise(resolve => setTimeout(resolve, 15000));
        
      } catch (restartError) {
        console.warn(`⚠️ Falha ao reiniciar ${authContainer}:`, restartError.message);
      }

      // 2. Também reiniciar Kong (proxy reverso para auth)
      const kongContainer = `supabase-kong-${instanceId}`;
      
      try {
        console.log(`🔄 Reiniciando proxy Kong...`);
        await execAsync(`docker restart ${kongContainer}`, { timeout: 60000 });
        results.containers_restarted.push(kongContainer);
        
        // Aguardar Kong ficar pronto
        await new Promise(resolve => setTimeout(resolve, 10000));
        
      } catch (kongError) {
        console.warn(`⚠️ Falha ao reiniciar Kong:`, kongError.message);
      }

      // 3. Testar serviços de auth
      console.log(`🔍 Testando serviços de autenticação...`);
      const authTests = await this.testAuthServices(instanceId);
      results.tests_performed = authTests;

      // 4. Verificar resultado
      const successfulTests = authTests.filter(test => test.success).length;
      results.success = successfulTests >= authTests.length * 0.7; // 70% dos testes devem passar

      if (results.success) {
        console.log(`✅ Serviço de autenticação corrigido (${successfulTests}/${authTests.length} testes passaram)`);
        return {
          success: true,
          message: `Serviço de autenticação reiniciado com sucesso`,
          details: results
        };
      } else {
        throw new Error(`Poucos testes passaram: ${successfulTests}/${authTests.length}`);
      }

    } catch (error) {
      console.error(`❌ Erro na correção do serviço de auth:`, error);
      throw new Error(`Falha na correção do auth: ${error.message}`);
    }
  }

  /**
   * Reinicia serviços HTTP (REST API, etc.)
   */
  async restartHttpServices(instanceId, parameters) {
    try {
      console.log(`🌐 Reiniciando serviços HTTP da instância ${instanceId}`);
      
      const results = {
        containers_restarted: [],
        services_tested: [],
        success: false
      };

      // Lista de containers de serviços HTTP
      const httpContainers = [
        `supabase-rest-${instanceId}`,  // PostgREST
        `supabase-kong-${instanceId}`,  // Kong Gateway
        `supabase-storage-${instanceId}` // Storage
      ];

      // 1. Reiniciar containers de serviços HTTP
      for (const containerName of httpContainers) {
        try {
          console.log(`🔄 Reiniciando ${containerName}...`);
          await execAsync(`docker restart ${containerName}`, { timeout: 60000 });
          results.containers_restarted.push(containerName);
          
          // Pausa entre restarts
          await new Promise(resolve => setTimeout(resolve, 5000));
          
        } catch (containerError) {
          console.warn(`⚠️ Falha ao reiniciar ${containerName}:`, containerError.message);
        }
      }

      // 2. Aguardar serviços ficarem prontos
      console.log(`⏳ Aguardando serviços ficarem prontos...`);
      await new Promise(resolve => setTimeout(resolve, 20000));

      // 3. Testar serviços HTTP
      console.log(`🔍 Testando serviços HTTP...`);
      const serviceTests = await this.testHttpServices(instanceId);
      results.services_tested = serviceTests;

      // 4. Verificar resultado
      const successfulTests = serviceTests.filter(test => test.success).length;
      results.success = successfulTests >= serviceTests.length * 0.6; // 60% dos testes devem passar

      if (results.success) {
        console.log(`✅ Serviços HTTP corrigidos (${successfulTests}/${serviceTests.length} testes passaram)`);
        return {
          success: true,
          message: `Serviços HTTP reiniciados com sucesso`,
          details: results
        };
      } else {
        throw new Error(`Poucos testes passaram: ${successfulTests}/${serviceTests.length}`);
      }

    } catch (error) {
      console.error(`❌ Erro na correção de serviços HTTP:`, error);
      throw new Error(`Falha na correção de serviços HTTP: ${error.message}`);
    }
  }

  /**
   * Testa serviços de autenticação
   */
  async testAuthServices(instanceId) {
    const instance = this.getInstanceConfig(instanceId);
    const tests = [];

    // 1. Teste do health endpoint
    try {
      const healthResponse = await fetch(
        `http://localhost:${instance.ports.kong_http}/auth/v1/health`,
        { timeout: 10000 }
      );
      
      tests.push({
        name: 'auth_health',
        success: healthResponse.ok,
        status_code: healthResponse.status,
        details: healthResponse.ok ? 'Health endpoint OK' : `Status ${healthResponse.status}`
      });
    } catch (error) {
      tests.push({
        name: 'auth_health',
        success: false,
        error: error.message
      });
    }

    // 2. Teste do settings endpoint
    try {
      const settingsResponse = await fetch(
        `http://localhost:${instance.ports.kong_http}/auth/v1/settings`,
        { 
          headers: { 'apikey': instance.credentials.anon_key },
          timeout: 10000 
        }
      );
      
      tests.push({
        name: 'auth_settings',
        success: settingsResponse.ok,
        status_code: settingsResponse.status,
        details: settingsResponse.ok ? 'Settings endpoint OK' : `Status ${settingsResponse.status}`
      });
    } catch (error) {
      tests.push({
        name: 'auth_settings',
        success: false,
        error: error.message
      });
    }

    // 3. Teste de validação JWT
    try {
      const jwt = require('jsonwebtoken');
      const testPayload = { test: true, iat: Math.floor(Date.now() / 1000) };
      
      const token = jwt.sign(testPayload, instance.credentials.jwt_secret);
      const decoded = jwt.verify(token, instance.credentials.jwt_secret);
      
      tests.push({
        name: 'jwt_validation',
        success: !!decoded.test,
        details: 'JWT validation OK'
      });
    } catch (error) {
      tests.push({
        name: 'jwt_validation',
        success: false,
        error: error.message
      });
    }

    return tests;
  }

  /**
   * Testa serviços HTTP gerais
   */
  async testHttpServices(instanceId) {
    const instance = this.getInstanceConfig(instanceId);
    const tests = [];

    // 1. Teste do Kong Gateway
    try {
      const kongResponse = await fetch(
        `http://localhost:${instance.ports.kong_http}/`,
        { timeout: 10000 }
      );
      
      tests.push({
        name: 'kong_gateway',
        success: kongResponse.status < 500, // 4xx é aceitável, 5xx não
        status_code: kongResponse.status,
        details: `Kong status ${kongResponse.status}`
      });
    } catch (error) {
      tests.push({
        name: 'kong_gateway',
        success: false,
        error: error.message
      });
    }

    // 2. Teste do PostgREST
    try {
      const restResponse = await fetch(
        `http://localhost:${instance.ports.kong_http}/rest/v1/`,
        { 
          headers: { 'apikey': instance.credentials.anon_key },
          timeout: 10000 
        }
      );
      
      tests.push({
        name: 'postgrest',
        success: restResponse.status < 500,
        status_code: restResponse.status,
        details: `PostgREST status ${restResponse.status}`
      });
    } catch (error) {
      tests.push({
        name: 'postgrest',
        success: false,
        error: error.message
      });
    }

    // 3. Teste do Studio (se disponível)
    try {
      const studioResponse = await fetch(
        `http://localhost:${instance.ports.kong_http}/`,
        { 
          timeout: 10000,
          headers: { 'Accept': 'text/html' }
        }
      );
      
      tests.push({
        name: 'studio',
        success: studioResponse.ok,
        status_code: studioResponse.status,
        details: studioResponse.ok ? 'Studio OK' : `Status ${studioResponse.status}`
      });
    } catch (error) {
      tests.push({
        name: 'studio',
        success: false,
        error: error.message
      });
    }

    return tests;
  }

  /**
   * Reinicia serviço específico por nome
   */
  async restartSpecificService(instanceId, serviceName) {
    try {
      const serviceContainerMap = {
        'auth': `supabase-auth-${instanceId}`,
        'rest': `supabase-rest-${instanceId}`,
        'kong': `supabase-kong-${instanceId}`,
        'storage': `supabase-storage-${instanceId}`,
        'realtime': `realtime-dev.supabase-realtime-${instanceId}`
      };

      const containerName = serviceContainerMap[serviceName];
      
      if (!containerName) {
        throw new Error(`Serviço desconhecido: ${serviceName}`);
      }

      console.log(`🔄 Reiniciando serviço ${serviceName} (${containerName})...`);
      
      await execAsync(`docker restart ${containerName}`, { timeout: 60000 });
      
      // Aguardar serviço ficar pronto
      await new Promise(resolve => setTimeout(resolve, 15000));
      
      console.log(`✅ Serviço ${serviceName} reiniciado`);
      
      return {
        success: true,
        service: serviceName,
        container: containerName,
        message: `Serviço ${serviceName} reiniciado com sucesso`
      };

    } catch (error) {
      throw new Error(`Falha ao reiniciar serviço ${serviceName}: ${error.message}`);
    }
  }

  /**
   * Verifica logs de um serviço para diagnosticar problemas
   */
  async checkServiceLogs(instanceId, serviceName, lines = 50) {
    try {
      const serviceContainerMap = {
        'auth': `supabase-auth-${instanceId}`,
        'rest': `supabase-rest-${instanceId}`,
        'kong': `supabase-kong-${instanceId}`,
        'storage': `supabase-storage-${instanceId}`
      };

      const containerName = serviceContainerMap[serviceName];
      
      if (!containerName) {
        return { success: false, error: `Serviço desconhecido: ${serviceName}` };
      }

      const { stdout, stderr } = await execAsync(
        `docker logs --tail ${lines} ${containerName}`,
        { timeout: 30000 }
      );

      return {
        success: true,
        service: serviceName,
        container: containerName,
        logs: {
          stdout: stdout,
          stderr: stderr
        }
      };

    } catch (error) {
      return {
        success: false,
        service: serviceName,
        error: error.message
      };
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

module.exports = ServiceFixer;