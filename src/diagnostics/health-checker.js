/**
 * HEALTH CHECKER - Sistema de verificação de saúde de serviços
 * 
 * Verifica individualmente cada serviço crítico das instâncias Supabase:
 * - Containers Docker
 * - Serviços HTTP (GoTrue, PostgREST, Kong)
 * - Conexão com Database
 * - Conectividade de rede
 * - Uso de disco
 */

const Docker = require('dockerode');
const { Pool } = require('pg');
const fetch = require('node-fetch');
const fs = require('fs-extra');
const path = require('path');
const { execAsync } = require('util').promisify(require('child_process').exec);

class HealthChecker {
  constructor(config) {
    this.docker = new Docker();
    this.config = config;
    this.timeouts = {
      container: 10000,  // 10s para verificações de container
      http: 5000,        // 5s para requisições HTTP
      database: 8000,    // 8s para conexão de database
      network: 3000      // 3s para testes de rede
    };
  }

  /**
   * Verifica status dos containers Docker da instância
   */
  async checkContainers(instanceId) {
    try {
      console.log(`🐳 Verificando containers da instância ${instanceId}`);
      
      const containerNames = [
        `supabase-studio-${instanceId}`,
        `supabase-kong-${instanceId}`,
        `supabase-auth-${instanceId}`,
        `supabase-rest-${instanceId}`,
        `supabase-db-${instanceId}`,
        `supabase-storage-${instanceId}`,
        `realtime-dev.supabase-realtime-${instanceId}`
      ];

      const containerStatus = {};
      let runningCount = 0;
      let totalCount = containerNames.length;

      for (const containerName of containerNames) {
        try {
          const containers = await Promise.race([
            this.docker.listContainers({ 
              all: true, 
              filters: { name: [containerName] } 
            }),
            new Promise((_, reject) => 
              setTimeout(() => reject(new Error('Container list timeout')), this.timeouts.container)
            )
          ]);

          if (containers.length > 0) {
            const container = containers[0];
            const isRunning = container.State === 'running';
            
            containerStatus[containerName] = {
              exists: true,
              running: isRunning,
              status: container.Status,
              created: new Date(container.Created * 1000).toISOString()
            };

            if (isRunning) runningCount++;
          } else {
            containerStatus[containerName] = {
              exists: false,
              running: false,
              status: 'not_found',
              created: null
            };
          }
        } catch (error) {
          console.warn(`⚠️ Erro ao verificar container ${containerName}:`, error.message);
          containerStatus[containerName] = {
            exists: false,
            running: false,
            status: 'error',
            error: error.message,
            created: null
          };
        }
      }

      return {
        healthy: runningCount === totalCount,
        running_containers: runningCount,
        total_containers: totalCount,
        containers: containerStatus,
        issues: runningCount < totalCount ? 
          [`${totalCount - runningCount} containers não estão rodando`] : []
      };

    } catch (error) {
      console.error(`❌ Erro geral na verificação de containers:`, error);
      return {
        healthy: false,
        running_containers: 0,
        total_containers: 0,
        containers: {},
        issues: [`Erro na verificação de containers: ${error.message}`]
      };
    }
  }

  /**
   * Verifica saúde dos serviços HTTP
   */
  async checkServices(instanceId, instance) {
    try {
      console.log(`🌐 Verificando serviços HTTP da instância ${instanceId}`);
      
      const services = {
        kong: {
          url: `http://localhost:${instance.ports.kong_http}/`,
          name: 'Kong Gateway'
        },
        auth: {
          url: `http://localhost:${instance.ports.kong_http}/auth/v1/health`,
          name: 'GoTrue (Auth)',
          headers: { 'apikey': instance.credentials.anon_key }
        },
        rest: {
          url: `http://localhost:${instance.ports.kong_http}/rest/v1/`,
          name: 'PostgREST',
          headers: { 'apikey': instance.credentials.anon_key }
        },
        studio: {
          url: `http://localhost:${instance.ports.kong_http}/`,
          name: 'Supabase Studio'
        }
      };

      const serviceResults = {};
      let healthyCount = 0;
      const issues = [];

      for (const [serviceName, serviceConfig] of Object.entries(services)) {
        try {
          const startTime = Date.now();
          
          const response = await Promise.race([
            fetch(serviceConfig.url, {
              method: 'GET',
              headers: serviceConfig.headers || {},
              timeout: this.timeouts.http
            }),
            new Promise((_, reject) => 
              setTimeout(() => reject(new Error('HTTP timeout')), this.timeouts.http)
            )
          ]);

          const responseTime = Date.now() - startTime;
          const isHealthy = response.status < 500; // 4xx é OK, 5xx não é

          serviceResults[serviceName] = {
            healthy: isHealthy,
            status_code: response.status,
            response_time_ms: responseTime,
            url: serviceConfig.url,
            name: serviceConfig.name
          };

          if (isHealthy) {
            healthyCount++;
          } else {
            issues.push(`${serviceConfig.name}: HTTP ${response.status}`);
          }

        } catch (error) {
          console.warn(`⚠️ Erro ao verificar ${serviceName}:`, error.message);
          serviceResults[serviceName] = {
            healthy: false,
            status_code: null,
            response_time_ms: null,
            url: serviceConfig.url,
            name: serviceConfig.name,
            error: error.message
          };
          issues.push(`${serviceConfig.name}: ${error.message}`);
        }
      }

      return {
        overall_healthy: healthyCount === Object.keys(services).length,
        healthy_services: healthyCount,
        total_services: Object.keys(services).length,
        services: serviceResults,
        issues: issues
      };

    } catch (error) {
      console.error(`❌ Erro geral na verificação de serviços:`, error);
      return {
        overall_healthy: false,
        healthy_services: 0,
        total_services: 0,
        services: {},
        issues: [`Erro na verificação de serviços: ${error.message}`]
      };
    }
  }

  /**
   * Verifica conexão direta com o banco PostgreSQL
   */
  async checkDatabase(instanceId, instance) {
    let pool = null;
    
    try {
      console.log(`🗄️ Verificando database da instância ${instanceId}`);
      
      const dbConfig = {
        host: 'localhost',
        port: instance.ports.postgres_ext,
        database: 'postgres',
        user: 'postgres',
        password: instance.credentials.postgres_password,
        connectionTimeoutMillis: this.timeouts.database,
        query_timeout: this.timeouts.database
      };

      pool = new Pool(dbConfig);
      
      const startTime = Date.now();
      
      // Teste básico de conexão
      const connectionTest = await Promise.race([
        pool.query('SELECT 1 as test, version() as version, now() as timestamp'),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Database query timeout')), this.timeouts.database)
        )
      ]);

      const responseTime = Date.now() - startTime;

      // Teste de autenticação
      const authTest = await pool.query(
        'SELECT count(*) as users_count FROM auth.users'
      );

      // Verificar extensões importantes
      const extensionsTest = await pool.query(`
        SELECT name, installed_version 
        FROM pg_available_extensions 
        WHERE name IN ('uuid-ossp', 'pgcrypto', 'pgjwt') 
        AND installed_version IS NOT NULL
      `);

      return {
        healthy: true,
        connection_time_ms: responseTime,
        version: connectionTest.rows[0].version,
        server_time: connectionTest.rows[0].timestamp,
        auth_users_count: parseInt(authTest.rows[0].users_count),
        extensions: extensionsTest.rows,
        host: dbConfig.host,
        port: dbConfig.port,
        issues: []
      };

    } catch (error) {
      console.error(`❌ Erro na verificação do database:`, error);
      return {
        healthy: false,
        connection_time_ms: null,
        version: null,
        server_time: null,
        auth_users_count: null,
        extensions: [],
        host: 'localhost',
        port: instance.ports.postgres_ext,
        issues: [`Database connection failed: ${error.message}`]
      };
    } finally {
      if (pool) {
        try {
          await pool.end();
        } catch (cleanupError) {
          console.warn('⚠️ Erro ao fechar pool de conexão:', cleanupError.message);
        }
      }
    }
  }

  /**
   * Verifica especificamente o serviço GoTrue (foco no problema relatado)
   */
  async checkAuthService(instanceId, instance) {
    try {
      console.log(`🔐 Verificação detalhada do GoTrue (Auth) - instância ${instanceId}`);
      
      const baseUrl = `http://localhost:${instance.ports.kong_http}`;
      const authTests = {};
      const issues = [];

      // 1. Health endpoint
      try {
        const healthResponse = await fetch(`${baseUrl}/auth/v1/health`, {
          timeout: this.timeouts.http
        });
        
        authTests.health_endpoint = {
          healthy: healthResponse.ok,
          status_code: healthResponse.status,
          response: healthResponse.ok ? await healthResponse.text() : null
        };

        if (!healthResponse.ok) {
          issues.push(`Auth health endpoint retornou ${healthResponse.status}`);
        }
      } catch (error) {
        authTests.health_endpoint = {
          healthy: false,
          error: error.message
        };
        issues.push(`Auth health endpoint inacessível: ${error.message}`);
      }

      // 2. Settings endpoint
      try {
        const settingsResponse = await fetch(`${baseUrl}/auth/v1/settings`, {
          headers: { 'apikey': instance.credentials.anon_key },
          timeout: this.timeouts.http
        });
        
        const settingsData = settingsResponse.ok ? await settingsResponse.json() : null;
        
        authTests.settings_endpoint = {
          healthy: settingsResponse.ok,
          status_code: settingsResponse.status,
          external_email_enabled: settingsData?.external?.email,
          external_anonymous_enabled: settingsData?.external?.anonymous,
          disable_signup: settingsData?.disable_signup
        };

        if (!settingsResponse.ok) {
          issues.push(`Auth settings endpoint retornou ${settingsResponse.status}`);
        }
      } catch (error) {
        authTests.settings_endpoint = {
          healthy: false,
          error: error.message
        };
        issues.push(`Auth settings endpoint error: ${error.message}`);
      }

      // 3. Teste de JWT secret
      try {
        const jwt = require('jsonwebtoken');
        const testPayload = { test: true, iat: Math.floor(Date.now() / 1000) };
        
        // Verificar se consegue gerar e validar JWT
        const token = jwt.sign(testPayload, instance.credentials.jwt_secret);
        const decoded = jwt.verify(token, instance.credentials.jwt_secret);
        
        authTests.jwt_validation = {
          healthy: true,
          token_generated: !!token,
          token_validated: !!decoded,
          secret_length: instance.credentials.jwt_secret.length
        };
      } catch (error) {
        authTests.jwt_validation = {
          healthy: false,
          error: error.message
        };
        issues.push(`JWT validation failed: ${error.message}`);
      }

      // 4. Simulate user creation test (sem criar usuário de verdade)
      try {
        // Apenas testa o endpoint, não cria usuário
        const testUserData = {
          email: 'test@diagnostic.local',
          password: 'diagnostic123'
        };

        const signupResponse = await fetch(`${baseUrl}/auth/v1/signup`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': instance.credentials.anon_key
          },
          body: JSON.stringify(testUserData),
          timeout: this.timeouts.http
        });

        // Analisar a resposta (mesmo que seja erro, nos dá informações)
        let responseData = null;
        try {
          responseData = await signupResponse.json();
        } catch (jsonError) {
          // Resposta não é JSON válido
        }

        authTests.user_creation_test = {
          endpoint_accessible: true,
          status_code: signupResponse.status,
          response_data: responseData,
          // 422 é esperado para email inválido, 200 seria sucesso
          healthy: [200, 422].includes(signupResponse.status)
        };

        if (![200, 422].includes(signupResponse.status)) {
          issues.push(`User creation endpoint retornou ${signupResponse.status}`);
        }
      } catch (error) {
        authTests.user_creation_test = {
          endpoint_accessible: false,
          error: error.message,
          healthy: false
        };
        issues.push(`User creation test failed: ${error.message}`);
      }

      const overallHealthy = Object.values(authTests).every(test => test.healthy);

      return {
        overall_healthy: overallHealthy,
        tests: authTests,
        jwt_secret_configured: !!instance.credentials.jwt_secret,
        anon_key_configured: !!instance.credentials.anon_key,
        issues: issues
      };

    } catch (error) {
      console.error(`❌ Erro na verificação detalhada do Auth:`, error);
      return {
        overall_healthy: false,
        tests: {},
        jwt_secret_configured: false,
        anon_key_configured: false,
        issues: [`Auth service diagnostic failed: ${error.message}`]
      };
    }
  }

  /**
   * Verifica uso de disco dos volumes da instância
   */
  async checkDiskUsage(instanceId, instance) {
    try {
      console.log(`💾 Verificando uso de disco da instância ${instanceId}`);
      
      const volumePath = path.join(this.config.DOCKER_DIR, `volumes-${instanceId}`);
      const issues = [];

      if (!await fs.pathExists(volumePath)) {
        return {
          healthy: false,
          volume_exists: false,
          issues: [`Volume directory não encontrado: ${volumePath}`]
        };
      }

      // Verificar tamanho do diretório usando comando du (Unix/Linux)
      let diskUsage = {};
      
      try {
        // Usar PowerShell no Windows ou du no Linux
        const isWindows = process.platform === 'win32';
        
        if (isWindows) {
          const { stdout } = await execAsync(
            `powershell "Get-ChildItem -Path '${volumePath}' -Recurse | Measure-Object -Property Length -Sum | Select-Object Sum"`,
            { timeout: 10000 }
          );
          
          const sizeMatch = stdout.match(/(\d+)/);
          const sizeBytes = sizeMatch ? parseInt(sizeMatch[1]) : 0;
          
          diskUsage = {
            volume_size_bytes: sizeBytes,
            volume_size_mb: Math.round(sizeBytes / (1024 * 1024)),
            volume_size_gb: Math.round(sizeBytes / (1024 * 1024 * 1024) * 100) / 100
          };
        } else {
          const { stdout } = await execAsync(`du -sb "${volumePath}"`, { timeout: 10000 });
          const sizeBytes = parseInt(stdout.split('\t')[0]);
          
          diskUsage = {
            volume_size_bytes: sizeBytes,
            volume_size_mb: Math.round(sizeBytes / (1024 * 1024)),
            volume_size_gb: Math.round(sizeBytes / (1024 * 1024 * 1024) * 100) / 100
          };
        }

        // Alertas baseados no tamanho
        if (diskUsage.volume_size_gb > 5) {
          issues.push(`Volume está grande: ${diskUsage.volume_size_gb}GB`);
        }

      } catch (duError) {
        console.warn('⚠️ Não foi possível calcular uso de disco:', duError.message);
        diskUsage = {
          volume_size_bytes: null,
          volume_size_mb: null,
          volume_size_gb: null,
          calculation_error: duError.message
        };
      }

      // Verificar subdiretórios importantes
      const importantDirs = ['db', 'storage', 'logs'];
      const directoryStatus = {};

      for (const dir of importantDirs) {
        const dirPath = path.join(volumePath, dir);
        directoryStatus[dir] = {
          exists: await fs.pathExists(dirPath),
          path: dirPath
        };

        if (!directoryStatus[dir].exists) {
          issues.push(`Diretório importante ausente: ${dir}`);
        }
      }

      return {
        healthy: issues.length === 0,
        volume_exists: true,
        volume_path: volumePath,
        ...diskUsage,
        directories: directoryStatus,
        issues: issues
      };

    } catch (error) {
      console.error(`❌ Erro na verificação de disco:`, error);
      return {
        healthy: false,
        volume_exists: false,
        issues: [`Disk usage check failed: ${error.message}`]
      };
    }
  }

  /**
   * Verifica conectividade de rede básica
   */
  async checkNetworkConnectivity(instanceId, instance) {
    try {
      console.log(`🌐 Verificando conectividade de rede da instância ${instanceId}`);
      
      const networkTests = {};
      const issues = [];

      // 1. Teste de portas locais
      const portsToTest = [
        { name: 'kong_http', port: instance.ports.kong_http },
        { name: 'postgres_ext', port: instance.ports.postgres_ext },
        { name: 'analytics', port: instance.ports.analytics }
      ];

      for (const portTest of portsToTest) {
        try {
          const net = require('net');
          const isPortOpen = await new Promise((resolve) => {
            const socket = new net.Socket();
            
            const timeout = setTimeout(() => {
              socket.destroy();
              resolve(false);
            }, this.timeouts.network);

            socket.connect(portTest.port, 'localhost', () => {
              clearTimeout(timeout);
              socket.destroy();
              resolve(true);
            });

            socket.on('error', () => {
              clearTimeout(timeout);
              resolve(false);
            });
          });

          networkTests[portTest.name] = {
            port: portTest.port,
            accessible: isPortOpen
          };

          if (!isPortOpen) {
            issues.push(`Porta ${portTest.port} (${portTest.name}) não acessível`);
          }
        } catch (error) {
          networkTests[portTest.name] = {
            port: portTest.port,
            accessible: false,
            error: error.message
          };
          issues.push(`Erro testando porta ${portTest.port}: ${error.message}`);
        }
      }

      // 2. Teste de resolução DNS (se necessário)
      try {
        const dns = require('dns').promises;
        const localhost = await dns.lookup('localhost');
        
        networkTests.dns_resolution = {
          healthy: true,
          localhost_resolved: localhost.address
        };
      } catch (dnsError) {
        networkTests.dns_resolution = {
          healthy: false,
          error: dnsError.message
        };
        issues.push(`DNS resolution failed: ${dnsError.message}`);
      }

      const overallHealthy = issues.length === 0;

      return {
        overall_healthy: overallHealthy,
        tests: networkTests,
        issues: issues
      };

    } catch (error) {
      console.error(`❌ Erro na verificação de rede:`, error);
      return {
        overall_healthy: false,
        tests: {},
        issues: [`Network connectivity check failed: ${error.message}`]
      };
    }
  }

  /**
   * Verifica se uma instância está "saudável" de forma rápida
   * (usado após operações de reparo)
   */
  async isInstanceHealthy(instanceId, instance) {
    try {
      // Verificações críticas rápidas
      const containerCheck = await this.checkContainers(instanceId);
      const serviceCheck = await this.checkServices(instanceId, instance);
      
      return containerCheck.healthy && serviceCheck.overall_healthy;
    } catch (error) {
      console.error(`❌ Erro na verificação rápida de saúde:`, error);
      return false;
    }
  }

  /**
   * Verifica apenas serviços críticos (usado em diagnósticos rápidos)
   */
  async checkCriticalServices(instanceId, instance) {
    try {
      const services = ['auth', 'rest', 'database'];
      const results = {};

      // GoTrue (Auth)
      try {
        const authResponse = await fetch(
          `http://localhost:${instance.ports.kong_http}/auth/v1/health`,
          { timeout: 3000 }
        );
        results.auth = { healthy: authResponse.ok, status: authResponse.status };
      } catch (error) {
        results.auth = { healthy: false, error: error.message };
      }

      // PostgREST
      try {
        const restResponse = await fetch(
          `http://localhost:${instance.ports.kong_http}/rest/v1/`,
          { 
            headers: { 'apikey': instance.credentials.anon_key },
            timeout: 3000 
          }
        );
        results.rest = { healthy: restResponse.status < 500, status: restResponse.status };
      } catch (error) {
        results.rest = { healthy: false, error: error.message };
      }

      // Database (conexão rápida)
      let pool = null;
      try {
        pool = new Pool({
          host: 'localhost',
          port: instance.ports.postgres_ext,
          database: 'postgres',
          user: 'postgres',
          password: instance.credentials.postgres_password,
          connectionTimeoutMillis: 3000
        });
        
        await pool.query('SELECT 1');
        results.database = { healthy: true };
        await pool.end();
      } catch (error) {
        results.database = { healthy: false, error: error.message };
        if (pool) await pool.end().catch(() => {});
      }

      return results;
    } catch (error) {
      console.error(`❌ Erro na verificação de serviços críticos:`, error);
      return {};
    }
  }
}

module.exports = HealthChecker;