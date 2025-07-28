/**
 * CREDENTIAL MANAGER - Gerenciamento seguro de credenciais
 * 
 * Responsável por regenerar e atualizar credenciais das instâncias quando necessário.
 */

const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');
const { execAsync } = require('util').promisify(require('child_process').exec);

class CredentialManager {
  constructor(config) {
    this.config = config;
  }

  /**
   * Regenera credenciais PostgreSQL de uma instância
   */
  async regenerateCredentials(instanceId, parameters) {
    try {
      console.log(`🔐 Regenerando credenciais PostgreSQL da instância ${instanceId}`);
      
      const instance = this.getInstanceConfig(instanceId);
      const backupCredentials = { ...instance.credentials };
      
      const results = {
        credentials_updated: [],
        files_updated: [],
        containers_restarted: []
      };

      // 1. Gerar novas credenciais
      console.log(`🔑 Gerando novas credenciais...`);
      const newCredentials = await this.generateNewCredentials();
      
      // 2. Backup das credenciais atuais
      await this.backupCurrentCredentials(instanceId, backupCredentials);
      
      // 3. Atualizar credenciais na configuração da instância
      console.log(`📝 Atualizando configuração da instância...`);
      instance.credentials.postgres_password = newCredentials.postgres_password;
      instance.credentials.jwt_secret = newCredentials.jwt_secret;
      instance.credentials.anon_key = newCredentials.anon_key;
      instance.credentials.service_role_key = newCredentials.service_role_key;
      
      results.credentials_updated = ['postgres_password', 'jwt_secret', 'anon_key', 'service_role_key'];

      // 4. Atualizar arquivo .env da instância
      console.log(`📄 Atualizando arquivo .env...`);
      await this.updateEnvFile(instanceId, instance, newCredentials);
      results.files_updated.push('.env');

      // 5. Salvar configuração atualizada
      this.saveInstanceConfig(instanceId, instance);

      // 6. Reiniciar containers afetados
      console.log(`🔄 Reiniciando containers afetados...`);
      const restartedContainers = await this.restartAffectedContainers(instanceId);
      results.containers_restarted = restartedContainers;

      // 7. Aguardar serviços ficarem prontos
      console.log(`⏳ Aguardando serviços ficarem prontos...`);
      await this.waitForServicesReady(instanceId, instance);

      // 8. Validar novas credenciais
      console.log(`✅ Validando novas credenciais...`);
      await this.validateNewCredentials(instanceId, instance);

      console.log(`✅ Credenciais regeneradas com sucesso`);

      return {
        success: true,
        message: 'Credenciais PostgreSQL regeneradas com sucesso',
        details: results,
        new_credentials: {
          postgres_password: '***HIDDEN***',
          jwt_secret_length: newCredentials.jwt_secret.length,
          keys_updated: results.credentials_updated.length
        }
      };

    } catch (error) {
      console.error(`❌ Erro na regeneração de credenciais:`, error);
      
      // Tentar restaurar credenciais antigas se possível
      try {
        await this.rollbackCredentials(instanceId, backupCredentials);
        throw new Error(`Falha na regeneração, credenciais restauradas: ${error.message}`);
      } catch (rollbackError) {
        throw new Error(`Falha crítica na regeneração de credenciais: ${error.message}. Rollback também falhou: ${rollbackError.message}`);
      }
    }
  }

  /**
   * Gera novas credenciais seguras
   */
  async generateNewCredentials() {
    return {
      postgres_password: this.generateSecurePassword(32),
      jwt_secret: this.generateJWTSecret(),
      anon_key: this.generateSupabaseKey('anon'),
      service_role_key: this.generateSupabaseKey('service_role')
    };
  }

  /**
   * Gera senha segura
   */
  generateSecurePassword(length = 32) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
    let password = '';
    
    for (let i = 0; i < length; i++) {
      password += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    
    return password;
  }

  /**
   * Gera JWT secret seguro
   */
  generateJWTSecret() {
    return crypto.randomBytes(64).toString('hex');
  }

  /**
   * Gera chaves Supabase (anon/service_role)
   */
  generateSupabaseKey(role) {
    const jwt = require('jsonwebtoken');
    const secret = this.generateJWTSecret();
    
    const payload = {
      iss: 'supabase',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + (365 * 24 * 60 * 60), // 1 ano
      role: role
    };
    
    return jwt.sign(payload, secret);
  }

  /**
   * Faz backup das credenciais atuais
   */
  async backupCurrentCredentials(instanceId, credentials) {
    const backupDir = path.join(this.config.DOCKER_DIR, `backup-credentials-${instanceId}`);
    await fs.ensureDir(backupDir);
    
    const backupFile = path.join(backupDir, `credentials-${Date.now()}.json`);
    await fs.writeJSON(backupFile, {
      instanceId,
      timestamp: new Date().toISOString(),
      credentials: credentials
    }, { spaces: 2 });
    
    console.log(`💾 Backup de credenciais salvo: ${backupFile}`);
  }

  /**
   * Atualiza arquivo .env da instância
   */
  async updateEnvFile(instanceId, instance, newCredentials) {
    const envFilePath = path.join(this.config.DOCKER_DIR, instance.docker.env_file);
    
    if (!await fs.pathExists(envFilePath)) {
      throw new Error(`Arquivo .env não encontrado: ${envFilePath}`);
    }

    // Ler arquivo atual
    let envContent = await fs.readFile(envFilePath, 'utf8');
    
    // Atualizar variáveis
    const updates = {
      'POSTGRES_PASSWORD': newCredentials.postgres_password,
      'JWT_SECRET': newCredentials.jwt_secret,
      'ANON_KEY': newCredentials.anon_key,
      'SERVICE_ROLE_KEY': newCredentials.service_role_key
    };

    Object.entries(updates).forEach(([key, value]) => {
      const regex = new RegExp(`^${key}=.*$`, 'm');
      if (regex.test(envContent)) {
        envContent = envContent.replace(regex, `${key}=${value}`);
      } else {
        envContent += `\n${key}=${value}`;
      }
    });

    // Salvar arquivo atualizado
    await fs.writeFile(envFilePath, envContent, 'utf8');
    console.log(`📄 Arquivo .env atualizado: ${envFilePath}`);
  }

  /**
   * Reinicia containers afetados pelas mudanças de credenciais
   */
  async restartAffectedContainers(instanceId) {
    const containersToRestart = [
      `supabase-db-${instanceId}`,
      `supabase-auth-${instanceId}`,
      `supabase-rest-${instanceId}`,
      `supabase-kong-${instanceId}`
    ];

    const restartedContainers = [];

    for (const containerName of containersToRestart) {
      try {
        console.log(`🔄 Reiniciando ${containerName}...`);
        
        await execAsync(`docker restart ${containerName}`, { timeout: 60000 });
        restartedContainers.push(containerName);
        
        // Pausa entre restarts
        await new Promise(resolve => setTimeout(resolve, 5000));
        
      } catch (error) {
        console.warn(`⚠️ Falha ao reiniciar ${containerName}:`, error.message);
      }
    }

    return restartedContainers;
  }

  /**
   * Aguarda serviços ficarem prontos após mudança de credenciais
   */
  async waitForServicesReady(instanceId, instance, timeout = 120000) {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeout) {
      try {
        // Testar conexão com database
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
        
        // Testar endpoint de auth
        const fetch = require('node-fetch');
        const authResponse = await fetch(
          `http://localhost:${instance.ports.kong_http}/auth/v1/health`,
          { timeout: 5000 }
        );
        
        if (authResponse.ok) {
          console.log(`✅ Serviços prontos após mudança de credenciais`);
          return true;
        }
        
      } catch (error) {
        // Serviços ainda não estão prontos
      }
      
      console.log(`⏳ Aguardando serviços ficarem prontos...`);
      await new Promise(resolve => setTimeout(resolve, 10000));
    }
    
    throw new Error(`Serviços não ficaram prontos em ${timeout}ms após mudança de credenciais`);
  }

  /**
   * Valida se as novas credenciais estão funcionando
   */
  async validateNewCredentials(instanceId, instance) {
    const validationResults = {
      database_connection: false,
      auth_service: false,
      jwt_validation: false
    };

    try {
      // 1. Validar conexão com database
      const { Pool } = require('pg');
      const pool = new Pool({
        host: 'localhost',
        port: instance.ports.postgres_ext,
        database: 'postgres',
        user: 'postgres',
        password: instance.credentials.postgres_password,
        connectionTimeoutMillis: 10000
      });
      
      const result = await pool.query('SELECT version()');
      await pool.end();
      
      if (result.rows.length > 0) {
        validationResults.database_connection = true;
        console.log(`✅ Conexão database validada`);
      }

      // 2. Validar serviço de auth
      const fetch = require('node-fetch');
      const authResponse = await fetch(
        `http://localhost:${instance.ports.kong_http}/auth/v1/settings`,
        { 
          headers: { 'apikey': instance.credentials.anon_key },
          timeout: 10000 
        }
      );
      
      if (authResponse.ok) {
        validationResults.auth_service = true;
        console.log(`✅ Serviço de auth validado`);
      }

      // 3. Validar JWT
      const jwt = require('jsonwebtoken');
      const testPayload = { test: true };
      const token = jwt.sign(testPayload, instance.credentials.jwt_secret);
      const decoded = jwt.verify(token, instance.credentials.jwt_secret);
      
      if (decoded.test) {
        validationResults.jwt_validation = true;
        console.log(`✅ JWT validation ok`);
      }

      const allValid = Object.values(validationResults).every(valid => valid);
      
      if (!allValid) {
        throw new Error(`Validação parcial falhou: ${JSON.stringify(validationResults)}`);
      }

      return validationResults;

    } catch (error) {
      throw new Error(`Validação de credenciais falhou: ${error.message}`);
    }
  }

  /**
   * Faz rollback das credenciais em caso de falha
   */
  async rollbackCredentials(instanceId, backupCredentials) {
    console.log(`🔄 Executando rollback de credenciais...`);
    
    const instance = this.getInstanceConfig(instanceId);
    
    // Restaurar credenciais na configuração
    instance.credentials = { ...backupCredentials };
    
    // Atualizar arquivo .env
    await this.updateEnvFile(instanceId, instance, backupCredentials);
    
    // Salvar configuração
    this.saveInstanceConfig(instanceId, instance);
    
    // Reiniciar containers
    await this.restartAffectedContainers(instanceId);
    
    console.log(`✅ Rollback de credenciais executado`);
  }

  /**
   * Obtém configuração da instância
   */
  getInstanceConfig(instanceId) {
    const instanceManager = require('../../management/instance-manager');
    return instanceManager.instances[instanceId];
  }

  /**
   * Salva configuração da instância
   */
  saveInstanceConfig(instanceId, instance) {
    const instanceManager = require('../../management/instance-manager');
    instanceManager.instances[instanceId] = instance;
    instanceManager.saveInstances();
  }
}

module.exports = CredentialManager;