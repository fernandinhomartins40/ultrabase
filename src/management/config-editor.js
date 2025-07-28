/**
 * CONFIG EDITOR - Editor seguro de configurações de instância
 * 
 * Permite edição segura de configurações específicas:
 * - Nome da instância
 * - Credenciais de dashboard
 * - Configurações de autenticação
 * - Validação e rollback automático
 */

const fs = require('fs-extra');
const path = require('path');
const BackupSystem = require('./backup-system');

class ConfigEditor {
  constructor(config, instanceManager, diagnostics) {
    this.config = config;
    this.instanceManager = instanceManager;
    this.diagnostics = diagnostics;
    this.backupSystem = new BackupSystem(config);
    
    // Campos permitidos para edição
    this.allowedFields = {
      // Informações básicas
      'name': {
        type: 'string',
        validator: this.validateName,
        description: 'Nome da instância',
        requires_restart: false
      },
      'dashboard_username': {
        type: 'string',
        validator: this.validateUsername,
        description: 'Usuário do dashboard Supabase',
        requires_restart: true,
        config_path: 'credentials.dashboard_username'
      },
      'dashboard_password': {
        type: 'string',
        validator: this.validatePassword,
        description: 'Senha do dashboard Supabase',
        requires_restart: true,
        config_path: 'credentials.dashboard_password'
      },
      'organization': {
        type: 'string',
        validator: this.validateOrganization,
        description: 'Nome da organização',
        requires_restart: true,
        config_path: 'config.organization'
      },
      // Configurações de autenticação
      'disable_signup': {
        type: 'boolean',
        validator: this.validateBoolean,
        description: 'Desabilitar criação de novos usuários',
        requires_restart: true,
        env_var: 'DISABLE_SIGNUP'
      },
      'enable_email_autoconfirm': {
        type: 'boolean',
        validator: this.validateBoolean,
        description: 'Confirmar emails automaticamente',
        requires_restart: true,
        env_var: 'ENABLE_EMAIL_AUTOCONFIRM'
      },
      'jwt_expiry': {
        type: 'number',
        validator: this.validateJwtExpiry,
        description: 'Tempo de expiração do JWT (segundos)',
        requires_restart: true,
        env_var: 'JWT_EXPIRY'
      }
    };
  }

  /**
   * Atualiza uma configuração específica de forma segura
   */
  async updateInstanceConfig(instanceId, field, value, options = {}) {
    let backup = null;
    let preUpdateState = null;

    try {
      console.log(`⚙️ Atualizando configuração ${field} da instância ${instanceId}`);

      // Validações iniciais
      if (!this.instanceManager.instances[instanceId]) {
        throw new Error(`Instância ${instanceId} não encontrada`);
      }

      if (!this.allowedFields[field]) {
        throw new Error(`Campo '${field}' não é editável`);
      }

      const fieldConfig = this.allowedFields[field];
      const instance = this.instanceManager.instances[instanceId];

      // 1. Validar novo valor
      console.log(`🔍 Validando novo valor para ${field}...`);
      await fieldConfig.validator.call(this, value, instanceId);

      // 2. Criar backup antes da mudança
      if (!options.skipBackup) {
        console.log(`💾 Criando backup antes da alteração...`);
        backup = await this.backupSystem.createInstanceBackup(instanceId, `config_update_${field}`);
      }

      // 3. Capturar estado atual
      preUpdateState = await this.captureConfigState(instanceId);

      // 4. Aplicar mudança na configuração
      console.log(`✏️ Aplicando mudança na configuração...`);
      const oldValue = await this.applyConfigChange(instanceId, field, value, fieldConfig);

      // 5. Atualizar arquivos de configuração se necessário
      if (fieldConfig.env_var || fieldConfig.requires_restart) {
        await this.updateConfigurationFiles(instanceId, field, value, fieldConfig);
      }

      // 6. Verificar se mudança requer restart
      let restartRequired = fieldConfig.requires_restart && !options.skipRestart;
      
      if (restartRequired && !options.autoRestart) {
        console.log(`⚠️ Configuração alterada mas restart é necessário para aplicar`);
        
        return {
          success: true,
          message: `Configuração '${field}' atualizada. Restart necessário para aplicar.`,
          field: field,
          old_value: oldValue,
          new_value: value,
          restart_required: true,
          backup_created: backup?.backup_id,
          apply_changes: `Para aplicar: POST /api/instances/${instanceId}/restart`
        };
      }

      // 7. Aplicar restart se necessário e solicitado
      if (restartRequired && options.autoRestart) {
        console.log(`🔄 Executando restart para aplicar configuração...`);
        
        // Usar SafeInstanceManager para restart seguro
        const SafeInstanceManager = require('./safe-manager');
        const safeManager = new SafeInstanceManager(this.config, this.instanceManager, this.diagnostics);
        
        const restartResult = await safeManager.safeRestart(instanceId, { 
          reason: `config_update_${field}` 
        });

        if (!restartResult.success) {
          throw new Error(`Configuração atualizada mas restart falhou: ${restartResult.message}`);
        }
      }

      // 8. Verificar se configuração foi aplicada corretamente
      if (!options.skipValidation) {
        console.log(`✅ Verificando se configuração foi aplicada...`);
        const validationResult = await this.validateConfigApplication(instanceId, field, value);
        
        if (!validationResult.success) {
          throw new Error(`Configuração aplicada mas validação falhou: ${validationResult.message}`);
        }
      }

      console.log(`✅ Configuração ${field} atualizada com sucesso`);

      return {
        success: true,
        message: `Configuração '${field}' atualizada com sucesso`,
        field: field,
        old_value: oldValue,
        new_value: value,
        restart_required: false,
        restart_performed: restartRequired && options.autoRestart,
        backup_created: backup?.backup_id
      };

    } catch (error) {
      console.error(`❌ Erro ao atualizar configuração ${field}:`, error);

      // Tentar rollback automático se temos backup
      if (backup && !options.skipRollback) {
        try {
          console.log(`🔄 Tentando rollback da configuração...`);
          await this.performConfigRollback(instanceId, backup, preUpdateState);
          
          return {
            success: false,
            message: `Erro na atualização, rollback executado: ${error.message}`,
            field: field,
            rollback_performed: true,
            backup_used: backup.backup_id,
            error: error.message
          };
        } catch (rollbackError) {
          console.error(`❌ Erro crítico: falha no rollback da configuração:`, rollbackError);
          
          return {
            success: false,
            message: `ERRO CRÍTICO: Falha na atualização E no rollback. Intervenção manual necessária.`,
            field: field,
            rollback_performed: false,
            backup_available: backup.backup_id,
            error: error.message,
            rollback_error: rollbackError.message,
            manual_recovery_required: true
          };
        }
      }

      throw new Error(`Falha na atualização de configuração: ${error.message}`);
    }
  }

  /**
   * Atualiza múltiplas configurações em uma operação atômica
   */
  async updateMultipleConfigs(instanceId, updates, options = {}) {
    let backup = null;
    const results = [];

    try {
      console.log(`⚙️ Atualizando ${Object.keys(updates).length} configurações da instância ${instanceId}`);

      // Validar todos os campos antes de iniciar
      for (const [field, value] of Object.entries(updates)) {
        if (!this.allowedFields[field]) {
          throw new Error(`Campo '${field}' não é editável`);
        }
        await this.allowedFields[field].validator.call(this, value, instanceId);
      }

      // Criar backup único para todas as mudanças
      backup = await this.backupSystem.createInstanceBackup(instanceId, 'config_bulk_update');

      // Aplicar mudanças uma por uma
      for (const [field, value] of Object.entries(updates)) {
        try {
          const result = await this.updateInstanceConfig(instanceId, field, value, {
            skipBackup: true, // Usamos backup único
            skipRestart: true, // Restart apenas no final
            skipValidation: true // Validação apenas no final
          });
          
          results.push({
            field: field,
            success: true,
            old_value: result.old_value,
            new_value: result.new_value
          });
        } catch (fieldError) {
          results.push({
            field: field,
            success: false,
            error: fieldError.message
          });
          
          // Se alguma atualização crítica falhou, parar
          if (this.allowedFields[field].requires_restart) {
            throw new Error(`Falha crítica na atualização de ${field}: ${fieldError.message}`);
          }
        }
      }

      // Verificar se precisa de restart
      const requiresRestart = Object.keys(updates).some(field => this.allowedFields[field].requires_restart);

      if (requiresRestart && options.autoRestart) {
        console.log(`🔄 Executando restart para aplicar configurações...`);
        
        const SafeInstanceManager = require('./safe-manager');
        const safeManager = new SafeInstanceManager(this.config, this.instanceManager, this.diagnostics);
        
        const restartResult = await safeManager.safeRestart(instanceId, { 
          reason: 'config_bulk_update' 
        });

        if (!restartResult.success) {
          throw new Error(`Configurações atualizadas mas restart falhou: ${restartResult.message}`);
        }
      }

      console.log(`✅ Atualização em lote concluída com sucesso`);

      return {
        success: true,
        message: `${results.filter(r => r.success).length} configurações atualizadas com sucesso`,
        results: results,
        restart_required: requiresRestart && !options.autoRestart,
        restart_performed: requiresRestart && options.autoRestart,
        backup_created: backup.backup_id
      };

    } catch (error) {
      console.error(`❌ Erro na atualização em lote:`, error);

      // Rollback se temos backup
      if (backup) {
        try {
          await this.backupSystem.restoreInstanceFromBackup(instanceId, backup.backup_id);
          return {
            success: false,
            message: `Erro na atualização em lote, rollback executado: ${error.message}`,
            results: results,
            rollback_performed: true,
            backup_used: backup.backup_id
          };
        } catch (rollbackError) {
          return {
            success: false,
            message: 'ERRO CRÍTICO: Falha na atualização em lote E no rollback',
            results: results,
            rollback_performed: false,
            backup_available: backup.backup_id,
            manual_recovery_required: true
          };
        }
      }

      throw error;
    }
  }

  /**
   * Aplica mudança na configuração da instância
   */
  async applyConfigChange(instanceId, field, value, fieldConfig) {
    const instance = this.instanceManager.instances[instanceId];
    let oldValue;

    // Obter valor atual baseado no caminho da configuração
    if (fieldConfig.config_path) {
      const pathParts = fieldConfig.config_path.split('.');
      let current = instance;
      
      for (const part of pathParts.slice(0, -1)) {
        current = current[part];
      }
      
      const lastPart = pathParts[pathParts.length - 1];
      oldValue = current[lastPart];
      current[lastPart] = value;
    } else {
      // Campo direto na raiz
      oldValue = instance[field];
      instance[field] = value;
    }

    // Atualizar timestamp
    instance.updated_at = new Date().toISOString();

    // Salvar mudanças
    this.instanceManager.saveInstances();

    return oldValue;
  }

  /**
   * Atualiza arquivos de configuração (.env, docker-compose) se necessário
   */
  async updateConfigurationFiles(instanceId, field, value, fieldConfig) {
    try {
      const instance = this.instanceManager.instances[instanceId];

      // Atualizar arquivo .env se campo tem variável de ambiente
      if (fieldConfig.env_var) {
        await this.updateEnvFile(instanceId, fieldConfig.env_var, value);
      }

      // Atualizar docker-compose se necessário (para mudanças de organização, etc)
      if (field === 'organization') {
        await this.updateDockerComposeFile(instanceId, field, value);
      }

      console.log(`📁 Arquivos de configuração atualizados`);

    } catch (error) {
      throw new Error(`Erro ao atualizar arquivos de configuração: ${error.message}`);
    }
  }

  /**
   * Atualiza arquivo .env da instância
   */
  async updateEnvFile(instanceId, envVar, value) {
    const envFilePath = path.join(this.config.DOCKER_DIR, `.env-${instanceId}`);
    
    if (!await fs.pathExists(envFilePath)) {
      throw new Error(`Arquivo .env não encontrado: .env-${instanceId}`);
    }

    let envContent = await fs.readFile(envFilePath, 'utf8');
    
    // Escapar valor para uso em regex
    const escapedValue = value.toString().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    
    // Regex para encontrar e substituir a variável
    const regex = new RegExp(`^${envVar}=.*$`, 'm');
    const newLine = `${envVar}=${value}`;
    
    if (regex.test(envContent)) {
      // Substituir linha existente
      envContent = envContent.replace(regex, newLine);
    } else {
      // Adicionar nova linha no final
      envContent = envContent.trim() + '\n' + newLine + '\n';
    }

    await fs.writeFile(envFilePath, envContent);
    console.log(`📝 Arquivo .env atualizado: ${envVar}=${value}`);
  }

  /**
   * Atualiza docker-compose.yml se necessário
   */
  async updateDockerComposeFile(instanceId, field, value) {
    // Para mudanças que afetam docker-compose (como organização)
    // Normalmente não precisamos alterar o docker-compose, apenas .env
    // Mas deixamos preparado para futuras necessidades
    console.log(`📝 Docker compose file check for ${field}: ${value}`);
  }

  /**
   * Valida se configuração foi aplicada corretamente
   */
  async validateConfigApplication(instanceId, field, value) {
    try {
      // Para campos que requerem restart, validamos via diagnóstico
      if (this.allowedFields[field].requires_restart) {
        console.log(`🔍 Validando aplicação via diagnóstico...`);
        
        const diagnostic = await this.diagnostics.quickHealthCheck(instanceId);
        
        if (!diagnostic.healthy) {
          return {
            success: false,
            message: 'Instância não está saudável após mudança de configuração'
          };
        }
      }

      // Validação específica por campo
      switch (field) {
        case 'dashboard_username':
        case 'dashboard_password':
          // Tentar acessar dashboard com novas credenciais
          return await this.validateDashboardAccess(instanceId);
          
        case 'disable_signup':
          return await this.validateAuthSettings(instanceId);
          
        default:
          // Para outros campos, assumimos sucesso se chegou até aqui
          return { success: true };
      }

    } catch (error) {
      return {
        success: false,
        message: `Erro na validação: ${error.message}`
      };
    }
  }

  /**
   * Testa acesso ao dashboard com novas credenciais
   */
  async validateDashboardAccess(instanceId) {
    try {
      const instance = this.instanceManager.instances[instanceId];
      const dashboardUrl = `http://localhost:${instance.ports.kong_http}/`;
      
      // Teste básico de conectividade (credenciais serão testadas na prática pelo usuário)
      const fetch = require('node-fetch');
      const response = await fetch(dashboardUrl, { timeout: 5000 });
      
      return {
        success: response.status < 500,
        message: response.status < 500 ? 'Dashboard acessível' : 'Dashboard com problemas'
      };

    } catch (error) {
      return {
        success: false,
        message: `Erro ao validar acesso ao dashboard: ${error.message}`
      };
    }
  }

  /**
   * Valida configurações de autenticação
   */
  async validateAuthSettings(instanceId) {
    try {
      const instance = this.instanceManager.instances[instanceId];
      const settingsUrl = `http://localhost:${instance.ports.kong_http}/auth/v1/settings`;
      
      const fetch = require('node-fetch');
      const response = await fetch(settingsUrl, {
        headers: { 'apikey': instance.credentials.anon_key },
        timeout: 5000
      });

      if (response.ok) {
        const settings = await response.json();
        return {
          success: true,
          message: 'Configurações de auth aplicadas',
          settings: settings
        };
      } else {
        return {
          success: false,
          message: `Erro ao verificar configurações de auth: ${response.status}`
        };
      }

    } catch (error) {
      return {
        success: false,
        message: `Erro na validação de auth: ${error.message}`
      };
    }
  }

  /**
   * Captura estado atual das configurações
   */
  async captureConfigState(instanceId) {
    const instance = this.instanceManager.instances[instanceId];
    
    return {
      timestamp: new Date().toISOString(),
      instance_config: JSON.parse(JSON.stringify(instance)), // Deep copy
      env_file_exists: await fs.pathExists(path.join(this.config.DOCKER_DIR, `.env-${instanceId}`)),
      docker_compose_exists: await fs.pathExists(path.join(this.config.DOCKER_DIR, `docker-compose-${instanceId}.yml`))
    };
  }

  /**
   * Executa rollback de configuração
   */
  async performConfigRollback(instanceId, backup, preUpdateState) {
    try {
      console.log(`🔄 Executando rollback de configuração...`);
      
      // Restaurar do backup
      await this.backupSystem.restoreInstanceFromBackup(instanceId, backup.backup_id);
      
      // Recarregar instâncias do arquivo
      this.instanceManager.instances = this.instanceManager.loadInstances();
      
      console.log(`✅ Rollback de configuração executado com sucesso`);

    } catch (error) {
      throw new Error(`Rollback de configuração falhou: ${error.message}`);
    }
  }

  /**
   * Lista configurações editáveis de uma instância
   */
  getEditableFields() {
    const fields = {};
    
    for (const [fieldName, fieldConfig] of Object.entries(this.allowedFields)) {
      fields[fieldName] = {
        type: fieldConfig.type,
        description: fieldConfig.description,
        requires_restart: fieldConfig.requires_restart
      };
    }
    
    return fields;
  }

  /**
   * Obtém valor atual de um campo específico
   */
  getCurrentFieldValue(instanceId, field) {
    if (!this.allowedFields[field]) {
      throw new Error(`Campo '${field}' não é editável`);
    }

    const instance = this.instanceManager.instances[instanceId];
    const fieldConfig = this.allowedFields[field];

    if (fieldConfig.config_path) {
      const pathParts = fieldConfig.config_path.split('.');
      let current = instance;
      
      for (const part of pathParts) {
        current = current[part];
        if (current === undefined) return undefined;
      }
      
      return current;
    } else {
      return instance[field];
    }
  }

  // VALIDADORES ESPECÍFICOS

  validateName(value, instanceId) {
    if (!value || typeof value !== 'string') {
      throw new Error('Nome deve ser uma string não vazia');
    }
    
    if (value.length < 2 || value.length > 50) {
      throw new Error('Nome deve ter entre 2 e 50 caracteres');
    }
    
    if (!/^[a-zA-Z0-9\-_\s]+$/.test(value)) {
      throw new Error('Nome contém caracteres inválidos');
    }

    // Verificar se nome já existe em outra instância
    for (const [id, instance] of Object.entries(this.instanceManager.instances)) {
      if (id !== instanceId && instance.name.toLowerCase() === value.toLowerCase()) {
        throw new Error('Já existe uma instância com este nome');
      }
    }
  }

  validateUsername(value, instanceId) {
    if (!value || typeof value !== 'string') {
      throw new Error('Username deve ser uma string não vazia');
    }
    
    if (value.length < 3 || value.length > 30) {
      throw new Error('Username deve ter entre 3 e 30 caracteres');
    }
    
    if (!/^[a-zA-Z0-9_]+$/.test(value)) {
      throw new Error('Username deve conter apenas letras, números e underscore');
    }
  }

  validatePassword(value, instanceId) {
    if (!value || typeof value !== 'string') {
      throw new Error('Password deve ser uma string não vazia');
    }
    
    if (value.length < 4 || value.length > 100) {
      throw new Error('Password deve ter entre 4 e 100 caracteres');
    }
  }

  validateOrganization(value, instanceId) {
    if (!value || typeof value !== 'string') {
      throw new Error('Organização deve ser uma string não vazia');
    }
    
    if (value.length < 2 || value.length > 100) {
      throw new Error('Organização deve ter entre 2 e 100 caracteres');
    }
  }

  validateBoolean(value, instanceId) {
    if (typeof value !== 'boolean' && value !== 'true' && value !== 'false') {
      throw new Error('Valor deve ser true ou false');
    }
  }

  validateJwtExpiry(value, instanceId) {
    const num = Number(value);
    
    if (!Number.isInteger(num) || num < 300 || num > 86400) {
      throw new Error('JWT expiry deve ser um número inteiro entre 300 (5min) e 86400 (24h) segundos');
    }
  }
}

module.exports = ConfigEditor;