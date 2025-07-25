#!/usr/bin/env node

/**
 * SUPABASE INSTANCE MANAGER
 * 
 * Sistema que replica a experiência do Supabase Cloud, permitindo criar e gerenciar
 * múltiplas instâncias Supabase isoladas em uma única VPS.
 * 
 * Funcionalidades:
 * - Dashboard web como supabase.com
 * - Criação de projetos isolados
 * - Gerenciamento de recursos e portas
 * - Acesso direto ao Studio de cada projeto
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs-extra');
const { v4: uuidv4 } = require('uuid');
const Docker = require('dockerode');
const helmet = require('helmet');
const WebSocket = require('ws');
const { exec } = require('child_process');
const { promisify } = require('util');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');

const execAsync = promisify(exec);
const docker = new Docker();
const app = express();
const PORT = process.env.MANAGER_PORT || 3080;

// Configurações do sistema
const DOCKER_DIR = path.join(__dirname, '..', 'supabase-core');
const DATA_FILE = path.join(__dirname, 'instances.json');
const USERS_FILE = path.join(__dirname, 'users.json');
const SERVER_IP = '82.25.69.57'; // IP da VPS
const EXTERNAL_IP = process.env.VPS_HOST || process.env.MANAGER_EXTERNAL_IP || SERVER_IP;
const JWT_SECRET = process.env.JWT_SECRET || 'ultrabase_jwt_secret_change_in_production';
console.log(`🌐 IP externo configurado: ${EXTERNAL_IP}`);

// Middleware - CSP mais permissivo para desenvolvimento
app.use(helmet({
  contentSecurityPolicy: false, // Desabilitar CSP que estava bloqueando o Studio
  crossOriginOpenerPolicy: false,
  crossOriginResourcePolicy: false,
  originAgentCluster: false,
}));
app.use(cors({
  origin: function(origin, callback) {
    // Permitir requisições sem origin (como Postman) e qualquer origin em desenvolvimento
    callback(null, true);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH', 'HEAD'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin'],
  exposedHeaders: ['Content-Length', 'X-Kuma-Revision'],
  maxAge: 86400 // 24 hours
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Static files with cache busting headers
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, path) => {
    // Disable cache for HTML files to ensure updates are loaded
    if (path.endsWith('.html') || path.endsWith('/')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.setHeader('X-App-Version', '2.0.0-generate-bash');
    }
  }
}));

// Logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.url}`);
  next();
});

// Configurações do sistema adaptadas para generate.bash
const CONFIG = {
  DOCKER_DIR: DOCKER_DIR,
  INSTANCES_FILE: DATA_FILE,
  SERVER_IP: SERVER_IP,
  EXTERNAL_IP: EXTERNAL_IP,
  PORT_RANGE: {
    KONG_HTTP: { min: 8100, max: 8199 },
    KONG_HTTPS: { min: 8400, max: 8499 },
    POSTGRES_EXT: { min: 5500, max: 5599 },
    SUPAVISOR: { min: 6500, max: 6599 },
    ANALYTICS: { min: 4100, max: 4199 }
  },
  MAX_INSTANCES: 50,
  GENERATE_SCRIPT: path.join(DOCKER_DIR, 'generate-adapted.bash')
};

/**
 * GERENCIADOR DE USUÁRIOS
 * Classe que gerencia autenticação e controle de acesso multi-usuário
 */
class UserManager {
  constructor() {
    this.users = this.loadUsers();
    this.initializeDefaultAdmin();
  }

  /**
   * Carrega usuários salvos do arquivo JSON
   */
  loadUsers() {
    try {
      if (fs.existsSync(USERS_FILE)) {
        const data = fs.readFileSync(USERS_FILE, 'utf8');
        return JSON.parse(data);
      }
      return {};
    } catch (error) {
      console.error('Erro ao carregar usuários:', error.message);
      return {};
    }
  }

  /**
   * Salva usuários no arquivo JSON
   */
  saveUsers() {
    try {
      fs.writeFileSync(USERS_FILE, JSON.stringify(this.users, null, 2));
    } catch (error) {
      console.error('Erro ao salvar usuários:', error.message);
      throw new Error('Falha ao salvar dados de usuários');
    }
  }

  /**
   * Inicializa usuário admin padrão se não existir
   */
  async initializeDefaultAdmin() {
    if (!this.users['admin']) {
      console.log('🔧 Criando usuário admin padrão...');
      await this.createUser('admin', 'admin', 'admin');
      console.log('✅ Usuário admin criado - Login: admin / Senha: admin');
    }
  }

  /**
   * Cria novo usuário
   */
  async createUser(username, password, role = 'user') {
    if (this.users[username]) {
      throw new Error('Usuário já existe');
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    this.users[username] = {
      id: username,
      password_hash: hashedPassword,
      role: role,
      projects: role === 'admin' ? ['*'] : [],
      created_at: new Date().toISOString()
    };

    this.saveUsers();
    console.log(`👤 Usuário ${username} criado com role ${role}`);
    return this.users[username];
  }

  /**
   * Autentica usuário
   */
  async authenticateUser(username, password) {
    const user = this.users[username];
    if (!user) {
      throw new Error('Usuário não encontrado');
    }

    const isValidPassword = await bcrypt.compare(password, user.password_hash);
    if (!isValidPassword) {
      throw new Error('Senha incorreta');
    }

    return user;
  }

  /**
   * Altera senha do usuário
   */
  async changePassword(username, currentPassword, newPassword) {
    const user = this.users[username];
    if (!user) {
      throw new Error('Usuário não encontrado');
    }

    // Verificar senha atual
    const isValidCurrentPassword = await bcrypt.compare(currentPassword, user.password_hash);
    if (!isValidCurrentPassword) {
      throw new Error('Senha atual incorreta');
    }

    // Validar nova senha
    if (!newPassword || newPassword.length < 4) {
      throw new Error('Nova senha deve ter pelo menos 4 caracteres');
    }

    if (newPassword === currentPassword) {
      throw new Error('A nova senha deve ser diferente da senha atual');
    }

    // Gerar hash da nova senha
    const newHashedPassword = await bcrypt.hash(newPassword, 12);
    
    // Atualizar usuário
    this.users[username].password_hash = newHashedPassword;
    this.users[username].updated_at = new Date().toISOString();
    
    this.saveUsers();
    console.log(`🔐 Senha alterada para usuário ${username}`);
    
    return true;
  }

  /**
   * Gera token JWT
   */
  generateToken(user) {
    const payload = {
      id: user.id,
      role: user.role,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + (24 * 60 * 60) // 24 horas
    };

    return jwt.sign(payload, JWT_SECRET);
  }

  /**
   * Verifica se token JWT é válido
   */
  verifyToken(token) {
    try {
      return jwt.verify(token, JWT_SECRET);
    } catch (error) {
      throw new Error('Token inválido');
    }
  }

  /**
   * Verifica se usuário pode acessar projeto
   */
  canAccessProject(username, projectId) {
    const user = this.users[username];
    if (!user) return false;

    // Admin pode acessar tudo
    if (user.role === 'admin') return true;

    // Usuário comum só pode acessar próprios projetos
    return user.projects.includes(projectId);
  }

  /**
   * Adiciona projeto ao usuário
   */
  addProjectToUser(username, projectId) {
    const user = this.users[username];
    if (!user) return false;

    if (user.role !== 'admin' && !user.projects.includes(projectId)) {
      user.projects.push(projectId);
      this.saveUsers();
    }

    return true;
  }

  /**
   * Remove projeto do usuário
   */
  removeProjectFromUser(username, projectId) {
    const user = this.users[username];
    if (!user) return false;

    if (user.role !== 'admin') {
      user.projects = user.projects.filter(id => id !== projectId);
      this.saveUsers();
    }

    return true;
  }

  /**
   * Lista usuários (apenas para admin)
   */
  listUsers() {
    return Object.values(this.users).map(user => ({
      id: user.id,
      role: user.role,
      projects: user.projects,
      created_at: user.created_at
    }));
  }
}

/**
 * GERENCIADOR DE INSTÂNCIAS
 * Classe principal que gerencia o ciclo de vida das instâncias Supabase
 */
class SupabaseInstanceManager {
  constructor() {
    this.instances = this.loadInstances();
    this.usedPorts = new Set();
    this.updateUsedPorts();
  }

  /**
   * Carrega instâncias salvas do arquivo JSON
   */
  loadInstances() {
    try {
      if (fs.existsSync(CONFIG.INSTANCES_FILE)) {
        const data = fs.readFileSync(CONFIG.INSTANCES_FILE, 'utf8');
        const instances = JSON.parse(data);
        
        // Migrar instâncias antigas para incluir owner
        let needsSave = false;
        Object.values(instances).forEach(instance => {
          if (!instance.owner) {
            instance.owner = 'admin'; // Atribuir ao admin instâncias antigas
            needsSave = true;
            console.log(`🔄 Migrando instância ${instance.id} para o usuário admin`);
          }
        });
        
        // Salvar se houve migração
        if (needsSave) {
          fs.writeFileSync(CONFIG.INSTANCES_FILE, JSON.stringify(instances, null, 2));
          console.log('✅ Migração de dados concluída');
        }
        
        return instances;
      }
      return {};
    } catch (error) {
      console.error('Erro ao carregar instâncias:', error.message);
      return {};
    }
  }

  /**
   * Salva instâncias no arquivo JSON
   */
  saveInstances() {
    try {
      fs.writeFileSync(CONFIG.INSTANCES_FILE, JSON.stringify(this.instances, null, 2));
    } catch (error) {
      console.error('Erro ao salvar instâncias:', error.message);
      throw new Error('Falha ao salvar configuração das instâncias');
    }
  }

  /**
   * Atualiza conjunto de portas em uso
   */
  updateUsedPorts() {
    this.usedPorts.clear();
    Object.values(this.instances).forEach(instance => {
      this.usedPorts.add(instance.ports.kong_http);
      this.usedPorts.add(instance.ports.kong_https);
      this.usedPorts.add(instance.ports.postgres_ext);
      if (instance.ports.supavisor) this.usedPorts.add(instance.ports.supavisor);
      this.usedPorts.add(instance.ports.analytics);
    });
  }

  /**
   * Gera porta aleatória disponível para um serviço específico
   */
  generateAvailablePort(service) {
    const range = CONFIG.PORT_RANGE[service.toUpperCase()];
    if (!range) throw new Error(`Serviço desconhecido: ${service}`);

    let attempts = 0;
    while (attempts < 100) {
      const port = Math.floor(Math.random() * (range.max - range.min + 1)) + range.min;
      if (!this.usedPorts.has(port)) {
        this.usedPorts.add(port);
        return port;
      }
      attempts++;
    }
    throw new Error(`Não foi possível encontrar uma porta disponível para ${service}`);
  }

  /**
   * Gera configuração completa de uma nova instância
   */
  generateInstanceConfig(projectName, customConfig = {}) {
    const instanceId = uuidv4().replace(/-/g, '').substring(0, 8);
    const timestamp = Date.now();

    // Usar IP externo configurado globalmente
    const externalIP = EXTERNAL_IP;

    // Gerar portas únicas
    const ports = {
      kong_http: this.generateAvailablePort('kong_http'),
      kong_https: this.generateAvailablePort('kong_https'),
      postgres_ext: this.generateAvailablePort('postgres_ext'),
      supavisor: this.generateAvailablePort('supavisor'),
      analytics: this.generateAvailablePort('analytics')
    };

    // Gerar credenciais únicas
    const jwtSecret = this.generateJWTSecret();
    console.log(`🔐 Gerando credenciais JWT para instância ${instanceId}`);
    
    const anonKey = this.generateSupabaseKey('anon', jwtSecret);
    const serviceRoleKey = this.generateSupabaseKey('service_role', jwtSecret);
    
    // Validar tokens gerados
    this.validateSupabaseKey(anonKey, jwtSecret);
    this.validateSupabaseKey(serviceRoleKey, jwtSecret);
    
    const credentials = {
      postgres_password: this.generateSecurePassword(),
      jwt_secret: jwtSecret,
      anon_key: anonKey,
      service_role_key: serviceRoleKey,
      dashboard_username: 'admin',
      dashboard_password: 'admin',
      vault_enc_key: this.generateSecurePassword(32),
      logflare_api_key: this.generateSecurePassword(24)
    };

    return {
      id: instanceId,
      name: projectName,
      owner: customConfig.owner || 'admin', // Adicionar owner
      status: 'creating',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      ports,
      credentials,
      urls: {
        studio: `http://${CONFIG.SERVER_IP}:${ports.kong_http}`,
        api: `http://${CONFIG.SERVER_IP}:${ports.kong_http}`,
        db: `postgresql://postgres:${credentials.postgres_password}@${CONFIG.SERVER_IP}:${ports.postgres_ext}/postgres`
      },
      docker: {
        compose_file: `docker-compose-${instanceId}.yml`,
        env_file: `.env-${instanceId}`,
        volumes_dir: `volumes-${instanceId}`
      },
      config: {
        organization: customConfig.organization || 'Default Organization',
        project: projectName,
        ...customConfig
      }
    };
  }

  /**
   * Gera senha segura
   */
  generateSecurePassword(length = 16) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  /**
   * Gera JWT Secret
   */
  generateJWTSecret() {
    return this.generateSecurePassword(64);
  }

  /**
   * Gera chaves Supabase (ANON_KEY e SERVICE_ROLE_KEY)
   * Implementação completa com JWT válido
   */
  generateSupabaseKey(role, jwtSecret) {
    const now = Math.floor(Date.now() / 1000);
    
    const payload = {
      role: role,
      iss: 'supabase-instance-manager',
      iat: now,
      exp: now + (365 * 24 * 60 * 60) // 1 ano de validade
    };
    
    // Gerar JWT válido usando a biblioteca jsonwebtoken
    return jwt.sign(payload, jwtSecret, { 
      algorithm: 'HS256',
      header: {
        alg: 'HS256',
        typ: 'JWT'
      }
    });
  }

  /**
   * Valida se um token JWT é válido
   */
  validateSupabaseKey(token, jwtSecret) {
    try {
      const decoded = jwt.verify(token, jwtSecret);
      console.log(`✅ Token JWT válido para role: ${decoded.role}`);
      return decoded;
    } catch (error) {
      console.error(`❌ Token JWT inválido: ${error.message}`);
      return null;
    }
  }

  /**
   * Lista todas as instâncias
   */
  async listInstances() {
    try {
      console.log('📋 Listando instâncias...');
      console.log('Instâncias carregadas:', Object.keys(this.instances).length);
      
      const instances = Object.values(this.instances);
      
      // Se não há instâncias, retornar imediatamente sem verificar Docker
      if (instances.length === 0) {
        console.log('📝 Nenhuma instância encontrada, retornando lista vazia');
        return {
          instances: [],
          stats: {
            total: 0,
            running: 0,
            stopped: 0,
            max_instances: CONFIG.MAX_INSTANCES
          }
        };
      }
      
      // Verificar se Docker está disponível apenas quando há instâncias
      let dockerAvailable = false;
      try {
        await Promise.race([
          docker.ping(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Docker ping timeout')), 5000))
        ]);
        dockerAvailable = true;
        console.log('✅ Docker está disponível');
      } catch (dockerError) {
        console.warn('⚠️ Docker não está disponível ou timeout:', dockerError.message);
        dockerAvailable = false;
      }
      
      // Atualizar status das instâncias verificando containers (apenas se Docker disponível)
      if (dockerAvailable) {
        for (const instance of instances) {
          try {
            instance.status = await this.getInstanceStatus(instance);
          } catch (statusError) {
            console.warn(`⚠️ Erro ao verificar status da instância ${instance.id}:`, statusError.message);
            // Manter status anterior ou definir como error
            instance.status = instance.status || 'error';
          }
        }
      } else {
        // Se Docker não está disponível, usar status salvo ou marcar como indisponível
        instances.forEach(instance => {
          instance.status = instance.status || 'unavailable';
        });
        console.log('🔧 Docker indisponível, usando status salvos');
      }
      
      // Formatar instâncias para frontend com studio_url
      const formattedInstances = instances.map(instance => ({
        ...instance,
        studio_url: instance.urls?.studio || `http://${CONFIG.SERVER_IP}:${instance.ports?.kong_http || 'N/A'}`
      }));
      
      const result = {
        instances: formattedInstances,
        stats: {
          total: instances.length,
          running: instances.filter(i => i.status === 'running').length,
          stopped: instances.filter(i => i.status === 'stopped').length,
          max_instances: CONFIG.MAX_INSTANCES
        }
      };
      
      console.log('📊 Estatísticas:', result.stats);
      return result;
      
    } catch (error) {
      console.error('❌ Erro ao listar instâncias:', error);
      // Retornar estrutura básica mesmo em caso de erro
      return {
        instances: [],
        stats: {
          total: 0,
          running: 0,
          stopped: 0,
          max_instances: CONFIG.MAX_INSTANCES
        }
      };
    }
  }

  /**
   * Verifica status de uma instância específica
   */
  async getInstanceStatus(instance) {
    try {
      // Verificar containers com timeout
      const containers = await Promise.race([
        docker.listContainers({ 
          all: true, 
          filters: { name: [`supabase-studio-${instance.id}`] } 
        }),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Container list timeout')), 10000)
        )
      ]);
      
      if (containers.length === 0) {
        console.log(`📦 Nenhum container encontrado para instância ${instance.id}`);
        return 'stopped';
      }
      
      const status = containers[0].State === 'running' ? 'running' : 'stopped';
      console.log(`📦 Status da instância ${instance.id}: ${status}`);
      return status;
      
    } catch (error) {
      console.warn(`⚠️ Erro ao verificar status da instância ${instance.id}:`, error.message);
      return 'error';
    }
  }

  /**
   * Cria nova instância Supabase usando generate.bash
   */
  async createInstance(projectName, customConfig = {}) {
    let instance = null;
    
    try {
      console.log(`🚀 Iniciando criação do projeto: ${projectName}`);
      
      // Validações
      if (!projectName || projectName.trim().length === 0) {
        throw new Error('Nome do projeto é obrigatório');
      }

      if (Object.keys(this.instances).length >= CONFIG.MAX_INSTANCES) {
        throw new Error(`Limite máximo de ${CONFIG.MAX_INSTANCES} instâncias atingido`);
      }

      // Verificar se já existe projeto com esse nome
      const existingProject = Object.values(this.instances).find(
        i => i.name.toLowerCase() === projectName.toLowerCase()
      );
      if (existingProject) {
        throw new Error('Já existe um projeto com este nome');
      }
      
      // Verificar se Docker está disponível
      try {
        await docker.ping();
        console.log('✅ Docker está disponível');
      } catch (dockerError) {
        throw new Error('Docker não está disponível. Verifique se o Docker está instalado e rodando.');
      }
      
      // Verificar se diretório do Docker existe
      if (!await fs.pathExists(CONFIG.DOCKER_DIR)) {
        throw new Error(`Diretório Docker não encontrado: ${CONFIG.DOCKER_DIR}`);
      }

      // Gerar configuração básica para controle
      console.log('⚙️ Preparando configuração da instância...');
      instance = this.generateInstanceConfig(projectName, customConfig);
      
      // Definir status como 'creating'
      instance.status = 'creating';
      
      // Salvar instância
      this.instances[instance.id] = instance;
      this.saveInstances();
      
      console.log(`💾 Instância ${instance.id} salva com status 'creating'`);

      // Executar generate.bash para criar e iniciar a instância
      console.log('🔧 Executando generate.bash para criar instância...');
      console.log('⏳ ATENÇÃO: Primeira criação pode demorar 5-10 minutos (download de imagens Docker)');
      
      try {
        await this.executeGenerateScript(instance);
        
        // Atualizar status para running após sucesso
        instance.status = 'running';
        instance.updated_at = new Date().toISOString();
        this.saveInstances();
        
        console.log(`✅ Instância ${instance.id} criada e iniciada com sucesso via generate.bash`);
        
      } catch (scriptError) {
        console.error(`❌ Erro ao executar generate.bash para ${instance.id}:`, scriptError);
        instance.status = 'error';
        instance.error_message = scriptError.message;
        instance.updated_at = new Date().toISOString();
        this.saveInstances();
        throw scriptError;
      }

      console.log(`✅ Instância ${projectName} (${instance.id}) criada com sucesso`);
      
      return {
        success: true,
        instance: instance,
        message: `Projeto "${projectName}" criado com sucesso! Acesse: ${instance.urls.studio}`
      };

    } catch (error) {
      console.error('❌ Erro ao criar instância:', error);
      
      // Limpar instância em caso de erro
      if (instance && instance.id && this.instances[instance.id]) {
        console.log(`🧹 Limpando instância falhada ${instance.id}...`);
        try {
          await this.deleteInstance(instance.id);
        } catch (cleanupError) {
          console.error('⚠️ Erro na limpeza:', cleanupError.message);
        }
      }
      
      throw new Error(`Falha ao criar projeto: ${error.message}`);
    }
  }

  /**
   * Executa generate.bash para criar instância Supabase
   */
  async executeGenerateScript(instance) {
    try {
      const dockerDir = CONFIG.DOCKER_DIR;
      const generateScript = path.join(dockerDir, 'generate.bash');
      
      // Verificar se script existe
      if (!await fs.pathExists(generateScript)) {
        throw new Error(`Script generate.bash não encontrado em: ${generateScript}`);
      }
      
      // Preparar variáveis de ambiente para o script
      const scriptEnv = this.prepareScriptEnvironment(instance);
      
      console.log(`🔧 Executando generate.bash para instância ${instance.id}...`);
      console.log(`📁 Diretório: ${dockerDir}`);
      
      // Executar script com timeout de 15 minutos
      const command = `cd "${dockerDir}" && bash generate-adapted.bash`;
      const { stdout, stderr } = await execAsync(command, {
        timeout: 900000, // 15 minutos
        maxBuffer: 1024 * 1024 * 10, // 10MB buffer
        env: { ...process.env, ...scriptEnv }
      });
      
      console.log('📋 Script output:', stdout);
      if (stderr) {
        console.warn('⚠️ Script warnings:', stderr);
      }
      
      // Verificar se arquivos foram criados
      const envFile = path.join(dockerDir, `.env-${instance.id}`);
      const composeFile = path.join(dockerDir, `docker-compose-${instance.id}.yml`);
      
      if (!await fs.pathExists(envFile)) {
        throw new Error(`Arquivo .env-${instance.id} não foi criado pelo script`);
      }
      
      if (!await fs.pathExists(composeFile)) {
        throw new Error(`Arquivo docker-compose-${instance.id}.yml não foi criado pelo script`);
      }
      
      // Atualizar referências nos dados da instância
      instance.docker.env_file = `.env-${instance.id}`;
      instance.docker.compose_file = `docker-compose-${instance.id}.yml`;
      instance.docker.volumes_dir = `volumes-${instance.id}`;
      
      console.log(`✅ Generate.bash executado com sucesso para instância ${instance.id}`);
      
    } catch (error) {
      throw new Error(`Erro ao executar generate.bash: ${error.message}`);
    }
  }

  /**
   * Prepara variáveis de ambiente para o script generate.bash
   */
  prepareScriptEnvironment(instance) {
    const { credentials, ports, config } = instance;
    
    return {
      // Identificação da instância (usar INSTANCE_ID para compatibilidade com script)
      MANAGER_INSTANCE_ID: instance.id,
      MANAGER_PROJECT_NAME: instance.name,
      MANAGER_ORGANIZATION_NAME: config.organization || 'Default Organization',
      
      // Credenciais geradas localmente
      MANAGER_POSTGRES_PASSWORD: credentials.postgres_password,
      MANAGER_JWT_SECRET: credentials.jwt_secret,
      MANAGER_ANON_KEY: credentials.anon_key,
      MANAGER_SERVICE_ROLE_KEY: credentials.service_role_key,
      MANAGER_DASHBOARD_USERNAME: credentials.dashboard_username,
      MANAGER_DASHBOARD_PASSWORD: credentials.dashboard_password,
      
      // Portas dinâmicas
      MANAGER_POSTGRES_PORT_EXT: ports.postgres_ext.toString(),
      MANAGER_POOLER_PORT_EXT: ports.supavisor.toString(),
      MANAGER_KONG_HTTP_PORT: ports.kong_http.toString(),
      MANAGER_KONG_HTTPS_PORT: ports.kong_https.toString(),
      MANAGER_ANALYTICS_PORT: ports.analytics.toString(),
      
      // IP externo dinâmico (será detectado pelo script ou usar VPS IP)
      MANAGER_EXTERNAL_IP: EXTERNAL_IP
    };
  }

  /**
   * Cria arquivos de configuração da instância (DEPRECATED - usando generate.bash)
   */
  async createInstanceFiles(instance) {
    try {
      const dockerDir = CONFIG.DOCKER_DIR;
      
      // Gerar arquivo .env
      const envContent = await this.generateEnvFile(instance);
      await fs.writeFile(path.join(dockerDir, instance.docker.env_file), envContent);

      // Gerar docker-compose.yml
      const composeContent = await this.generateComposeFile(instance);
      await fs.writeFile(path.join(dockerDir, instance.docker.compose_file), composeContent);

      // Criar diretórios de volumes
      await this.createVolumeDirectories(instance);

      console.log(`📁 Arquivos de configuração criados para instância ${instance.id}`);

    } catch (error) {
      throw new Error(`Erro ao criar arquivos de configuração: ${error.message}`);
    }
  }

  /**
   * Gera arquivo .env para a instância
   */
  async generateEnvFile(instance) {
    const { credentials, ports, config } = instance;
    const externalIP = EXTERNAL_IP;
    
    return `############
# Instance Identification
############

INSTANCE_ID=${instance.id}

############
# Secrets
############

POSTGRES_PASSWORD=${credentials.postgres_password}
JWT_SECRET=${credentials.jwt_secret}
ANON_KEY=${credentials.anon_key}
SERVICE_ROLE_KEY=${credentials.service_role_key}
DASHBOARD_USERNAME=${credentials.dashboard_username}
DASHBOARD_PASSWORD=${credentials.dashboard_password}
VAULT_ENC_KEY=${credentials.vault_enc_key}
SECRET_KEY_BASE=${this.generateSecurePassword(64)}

############
# Database
############

POSTGRES_HOST=db
POSTGRES_DB=postgres
POSTGRES_PORT=5432
POSTGRES_PORT_EXT=${ports.postgres_ext}

############
# Supavisor -- Database pooler
############
POOLER_PORT_EXT=${ports.supavisor}
POOLER_PROXY_PORT_TRANSACTION=6543
POOLER_DEFAULT_POOL_SIZE=20
POOLER_MAX_CLIENT_CONN=100
POOLER_TENANT_ID=${instance.id}

############
# API Proxy
############

KONG_HTTP_PORT=${ports.kong_http}
KONG_HTTPS_PORT=${ports.kong_https}

############
# API
############

PGRST_DB_SCHEMAS=public,storage,graphql_public

############
# Auth
############

SITE_URL=http://${externalIP}:3000
ADDITIONAL_REDIRECT_URLS=
JWT_EXPIRY=3600
DISABLE_SIGNUP=false
API_EXTERNAL_URL=http://${externalIP}:${ports.kong_http}

## Mailer Config
MAILER_URLPATHS_CONFIRMATION="/auth/v1/verify"
MAILER_URLPATHS_INVITE="/auth/v1/verify"
MAILER_URLPATHS_RECOVERY="/auth/v1/verify"
MAILER_URLPATHS_EMAIL_CHANGE="/auth/v1/verify"

## Email auth
ENABLE_EMAIL_SIGNUP=true
ENABLE_EMAIL_AUTOCONFIRM=true
SMTP_ADMIN_EMAIL=admin@example.com
SMTP_HOST=supabase-mail
SMTP_PORT=2500
SMTP_USER=fake_mail_user
SMTP_PASS=fake_mail_password
SMTP_SENDER_NAME=fake_sender
ENABLE_ANONYMOUS_USERS=true

## Phone auth
ENABLE_PHONE_SIGNUP=true
ENABLE_PHONE_AUTOCONFIRM=true

############
# Studio
############

STUDIO_DEFAULT_ORGANIZATION=${config.organization}
STUDIO_DEFAULT_PROJECT=${config.project}

STUDIO_PORT=3000
SUPABASE_PUBLIC_URL=http://${externalIP}:${ports.kong_http}

# Enable webp support
IMGPROXY_ENABLE_WEBP_DETECTION=true

############
# Functions
############

FUNCTIONS_VERIFY_JWT=false

############
# Logs
############

LOGFLARE_LOGGER_BACKEND_API_KEY=${credentials.logflare_api_key}
LOGFLARE_API_KEY=${credentials.logflare_api_key}
ANALYTICS_PORT=${ports.analytics}

# Docker socket location
DOCKER_SOCKET_LOCATION=/var/run/docker.sock
`;
  }

  /**
   * Gera arquivo docker-compose.yml para a instância
   */
  async generateComposeFile(instance) {
    // Ler template original e fazer substituições
    const originalComposePath = path.join(CONFIG.DOCKER_DIR, 'docker-compose.yml');
    let composeContent = await fs.readFile(originalComposePath, 'utf8');
    
    // Substituir variáveis específicas da instância
    composeContent = composeContent.replace(/supabase-studio-\${INSTANCE_ID}/g, `supabase-studio-${instance.id}`);
    composeContent = composeContent.replace(/supabase-kong-\${INSTANCE_ID}/g, `supabase-kong-${instance.id}`);
    composeContent = composeContent.replace(/supabase-auth-\${INSTANCE_ID}/g, `supabase-auth-${instance.id}`);
    composeContent = composeContent.replace(/supabase-rest-\${INSTANCE_ID}/g, `supabase-rest-${instance.id}`);
    composeContent = composeContent.replace(/realtime-dev\.supabase-realtime-\${INSTANCE_ID}/g, `realtime-dev.supabase-realtime-${instance.id}`);
    composeContent = composeContent.replace(/supabase-storage-\${INSTANCE_ID}/g, `supabase-storage-${instance.id}`);
    composeContent = composeContent.replace(/supabase-imgproxy-\${INSTANCE_ID}/g, `supabase-imgproxy-${instance.id}`);
    composeContent = composeContent.replace(/supabase-meta-\${INSTANCE_ID}/g, `supabase-meta-${instance.id}`);
    composeContent = composeContent.replace(/supabase-edge-functions-\${INSTANCE_ID}/g, `supabase-edge-functions-${instance.id}`);
    composeContent = composeContent.replace(/supabase-analytics-\${INSTANCE_ID}/g, `supabase-analytics-${instance.id}`);
    composeContent = composeContent.replace(/supabase-db-\${INSTANCE_ID}/g, `supabase-db-${instance.id}`);
    composeContent = composeContent.replace(/supabase-vector-\${INSTANCE_ID}/g, `supabase-vector-${instance.id}`);
    composeContent = composeContent.replace(/supabase-pooler-\${INSTANCE_ID}/g, `supabase-pooler-${instance.id}`);
    
    // Substituir referências de volumes
    composeContent = composeContent.replace(/volumes-\${INSTANCE_ID}/g, `volumes-${instance.id}`);
    composeContent = composeContent.replace(/db-data-\${INSTANCE_ID}/g, `db-data-${instance.id}`);
    
    // Atualizar nome do projeto
    composeContent = `name: supabase-${instance.id}\n\n` + composeContent.substring(composeContent.indexOf('services:'));
    
    return composeContent;
  }

  /**
   * Cria diretórios de volumes para a instância
   */
  async createVolumeDirectories(instance) {
    const dockerDir = CONFIG.DOCKER_DIR;
    const volumesDir = path.join(dockerDir, instance.docker.volumes_dir);

    // Criar estrutura de diretórios
    await fs.ensureDir(path.join(volumesDir, 'functions'));
    await fs.ensureDir(path.join(volumesDir, 'logs'));
    await fs.ensureDir(path.join(volumesDir, 'db', 'init'));
    await fs.ensureDir(path.join(volumesDir, 'api'));
    await fs.ensureDir(path.join(volumesDir, 'storage'));

    // Copiar arquivos base
    const baseVolumesDir = path.join(dockerDir, 'volumes');
    
    if (await fs.pathExists(path.join(baseVolumesDir, 'db'))) {
      await fs.copy(path.join(baseVolumesDir, 'db'), path.join(volumesDir, 'db'));
    }

    if (await fs.pathExists(path.join(baseVolumesDir, 'functions'))) {
      await fs.copy(path.join(baseVolumesDir, 'functions'), path.join(volumesDir, 'functions'));
    }

    // Gerar kong.yml específico da instância
    const kongTemplate = await fs.readFile(path.join(baseVolumesDir, 'api', 'kong.yml'), 'utf8');
    const kongContent = kongTemplate.replace(/\${INSTANCE_ID}/g, instance.id);
    await fs.writeFile(path.join(volumesDir, 'api', 'kong.yml'), kongContent);

    // Gerar vector.yml específico da instância
    if (await fs.pathExists(path.join(baseVolumesDir, 'logs', 'vector.yml'))) {
      const vectorTemplate = await fs.readFile(path.join(baseVolumesDir, 'logs', 'vector.yml'), 'utf8');
      const vectorContent = vectorTemplate.replace(/\${LOGFLARE_API_KEY}/g, instance.credentials.logflare_api_key);
      await fs.writeFile(path.join(volumesDir, 'logs', 'vector.yml'), vectorContent);
    }
  }

  /**
   * Inicia containers da instância
   */
  async startInstanceContainers(instance) {
    try {
      const dockerDir = CONFIG.DOCKER_DIR;
      const composeFile = path.join(dockerDir, instance.docker.compose_file);
      const envFile = path.join(dockerDir, instance.docker.env_file);

      console.log(`🚀 Iniciando containers para instância ${instance.id}...`);

      // Comando com timeout mais longo para primeira execução
      const command = `cd "${dockerDir}" && timeout 600 docker compose -f "${instance.docker.compose_file}" --env-file "${instance.docker.env_file}" up -d --pull always`;
      
      console.log(`Executando comando: ${command}`);
      
      const { stdout, stderr } = await execAsync(command, { 
        timeout: 600000, // 10 minutos
        maxBuffer: 1024 * 1024 * 10 // 10MB buffer
      });
      
      console.log('Docker stdout:', stdout);
      if (stderr) {
        console.log('Docker stderr:', stderr);
      }
      
      // Verificar se houve erros críticos
      if (stderr && (stderr.includes('ERROR') || stderr.includes('FATAL') || stderr.includes('failed'))) {
        throw new Error(`Erro crítico ao iniciar containers: ${stderr}`);
      }

      console.log(`✅ Containers iniciados para instância ${instance.id}`);

    } catch (error) {
      console.error(`❌ Erro detalhado ao iniciar containers para ${instance.id}:`, error);
      throw new Error(`Erro ao iniciar containers: ${error.message}`);
    }
  }

  /**
   * Aguarda containers estarem completamente prontos
   */
  async waitForContainersReady(instance, maxWaitTime = 300000) { // 5 minutos
    const startTime = Date.now();
    let attempts = 0;
    const maxAttempts = 60; // 1 tentativa por segundo por 1 minuto
    
    console.log(`⏳ Verificando se containers da instância ${instance.id} estão prontos...`);
    
    while (Date.now() - startTime < maxWaitTime && attempts < maxAttempts) {
      try {
        // Verificar se Kong (proxy principal) está respondendo
        // Usar localhost para verificações internas do servidor (mais confiável)
        const response = await fetch(`http://localhost:${instance.ports.kong_http}/api/health`, {
          timeout: 5000,
          headers: { 'User-Agent': 'Supabase-Instance-Manager' }
        });
        
        if (response.ok || response.status === 404) { // 404 é OK, significa que Kong está rodando
          console.log(`✅ Kong da instância ${instance.id} está respondendo na porta ${instance.ports.kong_http}`);
          return true;
        }
      } catch (error) {
        // Continuar tentando...
      }
      
      attempts++;
      console.log(`⏳ Tentativa ${attempts}/${maxAttempts} - Aguardando containers ficarem prontos...`);
      await new Promise(resolve => setTimeout(resolve, 5000)); // Aguardar 5 segundos
    }
    
    console.warn(`⚠️ Timeout aguardando containers da instância ${instance.id}. Continuando mesmo assim...`);
    return false; // Não falhar, apenas avisar
  }

  /**
   * Para uma instância
   */
  async stopInstance(instanceId) {
    try {
      if (!this.instances[instanceId]) {
        throw new Error('Instância não encontrada');
      }

      const instance = this.instances[instanceId];
      const dockerDir = CONFIG.DOCKER_DIR;

      const command = `cd "${dockerDir}" && docker compose -f "${instance.docker.compose_file}" down`;
      await execAsync(command);

      instance.status = 'stopped';
      instance.updated_at = new Date().toISOString();
      this.saveInstances();

      return { success: true, message: `Instância ${instance.name} parada com sucesso` };

    } catch (error) {
      throw new Error(`Erro ao parar instância: ${error.message}`);
    }
  }

  /**
   * Inicia uma instância parada
   */
  async startInstance(instanceId) {
    try {
      if (!this.instances[instanceId]) {
        throw new Error('Instância não encontrada');
      }

      const instance = this.instances[instanceId];
      await this.startInstanceContainers(instance);

      instance.status = 'running';
      instance.updated_at = new Date().toISOString();
      this.saveInstances();

      return { success: true, message: `Instância ${instance.name} iniciada com sucesso` };

    } catch (error) {
      throw new Error(`Erro ao iniciar instância: ${error.message}`);
    }
  }

  /**
   * Remove uma instância completamente
   */
  async deleteInstance(instanceId) {
    try {
      if (!this.instances[instanceId]) {
        throw new Error('Instância não encontrada');
      }

      const instance = this.instances[instanceId];
      const dockerDir = CONFIG.DOCKER_DIR;

      // Parar e remover containers
      const stopCommand = `cd "${dockerDir}" && docker compose -f "${instance.docker.compose_file}" down -v --remove-orphans`;
      await execAsync(stopCommand);

      // Remover arquivos de configuração
      await fs.remove(path.join(dockerDir, instance.docker.compose_file));
      await fs.remove(path.join(dockerDir, instance.docker.env_file));
      await fs.remove(path.join(dockerDir, instance.docker.volumes_dir));

      // Liberar portas
      this.usedPorts.delete(instance.ports.kong_http);
      this.usedPorts.delete(instance.ports.kong_https);
      this.usedPorts.delete(instance.ports.postgres_ext);
      if (instance.ports.supavisor) this.usedPorts.delete(instance.ports.supavisor);
      this.usedPorts.delete(instance.ports.analytics);

      // Remover do registro
      delete this.instances[instanceId];
      this.saveInstances();

      return { success: true, message: `Instância ${instance.name} removida com sucesso` };

    } catch (error) {
      throw new Error(`Erro ao remover instância: ${error.message}`);
    }
  }
}

// Instâncias globais dos gerenciadores
const userManager = new UserManager();
const manager = new SupabaseInstanceManager();

// Middleware de autenticação
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({ 
      error: 'Token de acesso requerido',
      code: 'NO_TOKEN'
    });
  }

  try {
    const decoded = userManager.verifyToken(token);
    req.user = decoded;
    next();
  } catch (error) {
    console.error('Erro de autenticação:', error.message);
    return res.status(403).json({ 
      error: 'Token inválido ou expirado',
      code: 'INVALID_TOKEN'
    });
  }
};

// Middleware para verificar se é admin
const requireAdmin = (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({
      error: 'Acesso negado. Permissões de administrador requeridas.',
      code: 'ADMIN_REQUIRED'
    });
  }
  next();
};

// Helper para verificar permissão de acesso ao projeto
const checkProjectAccess = async (req, res, next) => {
  const projectId = req.params.id;
  const userId = req.user.id;
  
  // Admin pode acessar tudo
  if (req.user.role === 'admin') {
    return next();
  }
  
  // Verificar se projeto existe
  const instance = manager.instances[projectId];
  if (!instance) {
    return res.status(404).json({
      error: 'Projeto não encontrado',
      code: 'PROJECT_NOT_FOUND'
    });
  }
  
  // Verificar se usuário pode acessar
  if (instance.owner !== userId && !userManager.canAccessProject(userId, projectId)) {
    return res.status(403).json({
      error: 'Acesso negado. Você não tem permissão para acessar este projeto.',
      code: 'PROJECT_ACCESS_DENIED'
    });
  }
  
  next();
};

// Rotas da API

/**
 * ENDPOINTS DE AUTENTICAÇÃO
 */

/**
 * Login de usuário
 */
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        error: 'Username e password são obrigatórios',
        code: 'MISSING_CREDENTIALS'
      });
    }

    console.log(`🔐 Tentativa de login: ${username}`);

    const user = await userManager.authenticateUser(username, password);
    const token = userManager.generateToken(user);

    console.log(`✅ Login bem-sucedido: ${username} (${user.role})`);

    res.json({
      success: true,
      token: token,
      user: {
        id: user.id,
        role: user.role,
        projects: user.projects,
        created_at: user.created_at
      }
    });

  } catch (error) {
    console.error('❌ Erro no login:', error.message);
    res.status(401).json({
      error: error.message,
      code: 'LOGIN_FAILED'
    });
  }
});

/**
 * Registro de novo usuário (apenas admin)
 */
app.post('/api/auth/register', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { username, password, role = 'user' } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        error: 'Username e password são obrigatórios',
        code: 'MISSING_CREDENTIALS'
      });
    }

    if (username.length < 3 || password.length < 4) {
      return res.status(400).json({
        error: 'Username deve ter pelo menos 3 caracteres e password pelo menos 4',
        code: 'INVALID_CREDENTIALS'
      });
    }

    console.log(`👤 Admin ${req.user.id} criando usuário: ${username}`);

    const newUser = await userManager.createUser(username, password, role);

    res.json({
      success: true,
      user: {
        id: newUser.id,
        role: newUser.role,
        projects: newUser.projects,
        created_at: newUser.created_at
      }
    });

  } catch (error) {
    console.error('❌ Erro no registro:', error.message);
    res.status(400).json({
      error: error.message,
      code: 'REGISTER_FAILED'
    });
  }
});

/**
 * Verificar token (para renovação automática)
 */
app.get('/api/auth/verify', authenticateToken, (req, res) => {
  res.json({
    success: true,
    user: {
      id: req.user.id,
      role: req.user.role,
      iat: req.user.iat,
      exp: req.user.exp
    }
  });
});

/**
 * Listar usuários (apenas admin)
 */
app.get('/api/auth/users', authenticateToken, requireAdmin, (req, res) => {
  try {
    const users = userManager.listUsers();
    res.json({
      success: true,
      users: users
    });
  } catch (error) {
    console.error('❌ Erro ao listar usuários:', error.message);
    res.status(500).json({
      error: error.message,
      code: 'LIST_USERS_FAILED'
    });
  }
});

/**
 * Alterar senha do usuário
 */
app.post('/api/auth/change-password', authenticateToken, async (req, res) => {
  try {
    const { currentPassword, newPassword, confirmPassword } = req.body;
    const userId = req.user.id;

    if (!currentPassword || !newPassword || !confirmPassword) {
      return res.status(400).json({
        error: 'Senha atual, nova senha e confirmação são obrigatórios',
        code: 'MISSING_PASSWORDS'
      });
    }

    if (newPassword !== confirmPassword) {
      return res.status(400).json({
        error: 'Nova senha e confirmação não coincidem',
        code: 'PASSWORD_MISMATCH'
      });
    }

    console.log(`🔐 Tentativa de alteração de senha para usuário: ${userId}`);

    await userManager.changePassword(userId, currentPassword, newPassword);

    console.log(`✅ Senha alterada com sucesso para usuário: ${userId}`);

    res.json({
      success: true,
      message: 'Senha alterada com sucesso'
    });

  } catch (error) {
    console.error('❌ Erro ao alterar senha:', error.message);
    res.status(400).json({
      error: error.message,
      code: 'CHANGE_PASSWORD_FAILED'
    });
  }
});

/**
 * Rota principal - serve o dashboard
 */
app.get('/', (req, res) => {
  console.log('🏠 Serving dashboard');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

/**
 * Lista todas as instâncias (filtradas por usuário)
 */
app.get('/api/instances', authenticateToken, async (req, res) => {
  try {
    console.log(`📎 GET /api/instances - Listando instâncias para usuário: ${req.user.id}`);
    const data = await manager.listInstances();
    
    // Filtrar instâncias por usuário (admin vê todas)
    let filteredInstances = data.instances;
    if (req.user.role !== 'admin') {
      filteredInstances = data.instances.filter(instance => {
        return instance.owner === req.user.id || userManager.canAccessProject(req.user.id, instance.id);
      });
    }
    
    const result = {
      ...data,
      instances: filteredInstances,
      stats: {
        ...data.stats,
        total: filteredInstances.length,
        running: filteredInstances.filter(i => i.status === 'running').length,
        stopped: filteredInstances.filter(i => i.status === 'stopped').length
      }
    };
    
    console.log(`📎 Respondendo com ${result.instances.length} instâncias para ${req.user.id} (role: ${req.user.role})`);
    res.json(result);
  } catch (error) {
    console.error('❌ Erro ao listar instâncias:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Cria nova instância
 */
app.post('/api/instances', authenticateToken, async (req, res) => {
  try {
    console.log('🚀 POST /api/instances - Criando nova instância...');
    console.log('Body recebido:', req.body);
    
    const { projectName, config = {} } = req.body;
    
    if (!projectName) {
      console.log('❌ Nome do projeto não fornecido');
      return res.status(400).json({ error: 'Nome do projeto é obrigatório' });
    }

    // Verificar se Docker está disponível antes de tentar criar
    try {
      await docker.ping();
    } catch (dockerError) {
      console.error('❌ Docker não está disponível para criação:', dockerError.message);
      return res.status(503).json({ 
        error: 'Serviço indisponível: Docker não está rodando. Verifique se está instalado e iniciado.',
        code: 'DOCKER_UNAVAILABLE'
      });
    }

    console.log(`🏠 Criando projeto: ${projectName} para usuário: ${req.user.id}`);
    
    // Adicionar owner ao config
    const configWithOwner = {
      ...config,
      owner: req.user.id
    };
    
    // Timeout mais longo para criação de instâncias (10 minutos)
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Timeout na criação do projeto (10 minutos). Tente novamente.')), 600000)
    );
    
    try {
      const result = await Promise.race([
        manager.createInstance(projectName, configWithOwner),
        timeoutPromise
      ]);
      
      // Adicionar projeto ao usuário
      if (req.user.role !== 'admin') {
        userManager.addProjectToUser(req.user.id, result.instance.id);
        console.log(`👤 Projeto ${result.instance.id} adicionado ao usuário ${req.user.id}`);
      }
      
      console.log('✅ Projeto criado com sucesso:', result.instance.id);
      console.log(`🔗 Studio URL: ${result.instance.urls.studio}`);
      console.log(`🔗 API URL: ${result.instance.urls.api}`);
      res.json(result);
      
    } catch (timeoutError) {
      if (timeoutError.message.includes('Timeout')) {
        console.error('⏰ Timeout na criação do projeto');
        res.status(408).json({ 
          error: 'Timeout na criação do projeto. Isso pode acontecer na primeira vez devido ao download das imagens Docker. Tente novamente em alguns minutos.',
          code: 'CREATION_TIMEOUT'
        });
      } else {
        throw timeoutError;
      }
    }
    
  } catch (error) {
    console.error('❌ Erro ao criar instância:', error);
    
    // Verificar se é erro específico do Docker
    if (error.message.includes('Docker') || error.message.includes('ENOENT')) {
      res.status(503).json({ 
        error: 'Docker não está disponível. Verifique se o Docker está instalado e rodando.',
        code: 'DOCKER_ERROR'
      });
    } else {
      res.status(500).json({ error: error.message });
    }
  }
});

/**
 * Para uma instância
 */
app.post('/api/instances/:id/stop', authenticateToken, checkProjectAccess, async (req, res) => {
  try {
    console.log(`⏸️ Usuário ${req.user.id} parando instância ${req.params.id}`);
    const result = await manager.stopInstance(req.params.id);
    res.json(result);
  } catch (error) {
    console.error('Erro ao parar instância:', error);
    res.status(400).json({ error: error.message });
  }
});

/**
 * Inicia uma instância
 */
app.post('/api/instances/:id/start', authenticateToken, checkProjectAccess, async (req, res) => {
  try {
    console.log(`▶️ Usuário ${req.user.id} iniciando instância ${req.params.id}`);
    const result = await manager.startInstance(req.params.id);
    res.json(result);
  } catch (error) {
    console.error('Erro ao iniciar instância:', error);
    res.status(400).json({ error: error.message });
  }
});

/**
 * Remove uma instância
 */
app.delete('/api/instances/:id', authenticateToken, checkProjectAccess, async (req, res) => {
  try {
    console.log(`🗑️ Usuário ${req.user.id} removendo instância ${req.params.id}`);
    
    // Remover projeto do usuário se não for admin
    if (req.user.role !== 'admin') {
      userManager.removeProjectFromUser(req.user.id, req.params.id);
    }
    
    const result = await manager.deleteInstance(req.params.id);
    res.json(result);
  } catch (error) {
    console.error('Erro ao remover instância:', error);
    res.status(400).json({ error: error.message });
  }
});

/**
 * Obtém detalhes de uma instância específica
 */
app.get('/api/instances/:id', authenticateToken, checkProjectAccess, async (req, res) => {
  try {
    const instance = manager.instances[req.params.id];
    if (!instance) {
      return res.status(404).json({ error: 'Instância não encontrada' });
    }

    // Atualizar status
    instance.status = await manager.getInstanceStatus(instance);
    
    res.json(instance);
  } catch (error) {
    console.error('Erro ao obter detalhes da instância:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Obtém logs de uma instância
 */
app.get('/api/instances/:id/logs', authenticateToken, checkProjectAccess, async (req, res) => {
  try {
    const instance = manager.instances[req.params.id];
    if (!instance) {
      return res.status(404).json({ error: 'Instância não encontrada' });
    }

    const command = `cd "${CONFIG.DOCKER_DIR}" && docker compose -f "${instance.docker.compose_file}" logs --tail=100`;
    const { stdout } = await execAsync(command);
    
    res.json({ logs: stdout });
  } catch (error) {
    console.error('Erro ao obter logs:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Obtém credenciais de uma instância
 */
app.get('/api/instances/:id/credentials', authenticateToken, checkProjectAccess, async (req, res) => {
  try {
    const instance = manager.instances[req.params.id];
    if (!instance) {
      return res.status(404).json({ error: 'Instância não encontrada' });
    }

    // Verificar se as credenciais estão disponíveis
    if (!instance.credentials) {
      return res.status(500).json({ error: 'Credenciais não encontradas para esta instância' });
    }

    const credentials = {
      // Informações da API
      supabase_url: instance.urls?.studio || `http://${EXTERNAL_IP}:${instance.ports.kong_http}`,
      api_url: `http://${EXTERNAL_IP}:${instance.ports.kong_http}/rest/v1`,
      
      // Chaves JWT
      anon_key: instance.credentials.anon_key,
      service_role_key: instance.credentials.service_role_key,
      
      // Credenciais de autenticação
      jwt_secret: instance.credentials.jwt_secret,
      
      // Credenciais do dashboard
      dashboard_username: instance.credentials.dashboard_username,
      dashboard_password: instance.credentials.dashboard_password,
      
      // Conexão direta do banco
      database: {
        host: EXTERNAL_IP,
        port: instance.ports.postgres_ext,
        database: 'postgres',
        username: 'postgres',
        password: instance.credentials.postgres_password
      },
      
      // Exemplo de código
      javascript_example: `import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'http://${EXTERNAL_IP}:${instance.ports.kong_http}'
const supabaseKey = '${instance.credentials.anon_key}'

const supabase = createClient(supabaseUrl, supabaseKey)`,
      
      curl_example: `curl -X GET 'http://${EXTERNAL_IP}:${instance.ports.kong_http}/rest/v1/' \\
  -H "apikey: ${instance.credentials.anon_key}" \\
  -H "Authorization: Bearer ${instance.credentials.anon_key}"`
    };

    res.json(credentials);
  } catch (error) {
    console.error('Erro ao obter credenciais:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Cursor Integration Configuration
 */
app.get('/api/instances/:id/cursor-config', authenticateToken, checkProjectAccess, async (req, res) => {
  try {
    const instance = manager.instances[req.params.id];
    if (!instance) {
      return res.status(404).json({ error: 'Instância não encontrada' });
    }

    const config = {
      project_id: instance.id,
      project_name: instance.name,
      supabase_url: instance.urls?.studio || `http://${EXTERNAL_IP}:${instance.ports.kong_http}`,
      api_url: `http://${EXTERNAL_IP}:${instance.ports.kong_http}/rest/v1`,
      anon_key: instance.credentials.anon_key,
      service_role_key: instance.credentials.service_role_key,
      database_url: `postgresql://postgres:${instance.credentials.postgres_password}@${EXTERNAL_IP}:${instance.ports.postgres_ext}/postgres`,
      
      // Arquivo .env pronto
      env_content: `# Ultrabase Supabase Instance - ${instance.name}
NEXT_PUBLIC_SUPABASE_URL=http://${EXTERNAL_IP}:${instance.ports.kong_http}
NEXT_PUBLIC_SUPABASE_ANON_KEY=${instance.credentials.anon_key}
SUPABASE_SERVICE_ROLE_KEY=${instance.credentials.service_role_key}
DATABASE_URL=postgresql://postgres:${instance.credentials.postgres_password}@${EXTERNAL_IP}:${instance.ports.postgres_ext}/postgres

# Optional: Direct Database Connection
DB_HOST=${EXTERNAL_IP}
DB_PORT=${instance.ports.postgres_ext}
DB_NAME=postgres
DB_USER=postgres
DB_PASS=${instance.credentials.postgres_password}`,

      // Frameworks code examples
      frameworks: {
        javascript: `import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'http://${EXTERNAL_IP}:${instance.ports.kong_http}'
const supabaseKey = '${instance.credentials.anon_key}'

export const supabase = createClient(supabaseUrl, supabaseKey)

// Test connection
supabase.from('_supabase_admin').select('*').limit(1)
  .then(({ data, error }) => {
    if (error) console.error('Connection error:', error)
    else console.log('✅ Connected to Supabase!')
  })`,
        
        typescript: `import { createClient, SupabaseClient } from '@supabase/supabase-js'

const supabaseUrl: string = 'http://${EXTERNAL_IP}:${instance.ports.kong_http}'
const supabaseKey: string = '${instance.credentials.anon_key}'

export const supabase: SupabaseClient = createClient(supabaseUrl, supabaseKey)

// Type-safe operations
interface User {
  id: string
  email: string
  created_at: string
}

export const getUsers = async (): Promise<User[]> => {
  const { data, error } = await supabase
    .from('users')
    .select('*')
  
  if (error) throw error
  return data || []
}`,

        react: `import React, { useState, useEffect } from 'react'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  'http://${EXTERNAL_IP}:${instance.ports.kong_http}',
  '${instance.credentials.anon_key}'
)

function App() {
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchData()
  }, [])

  const fetchData = async () => {
    try {
      const { data, error } = await supabase
        .from('users')
        .select('*')
      
      if (error) throw error
      setData(data || [])
    } catch (error) {
      console.error('Error:', error)
    } finally {
      setLoading(false)
    }
  }

  if (loading) return <div>Loading...</div>

  return (
    <div>
      <h1>Supabase React App</h1>
      <pre>{JSON.stringify(data, null, 2)}</pre>
    </div>
  )
}

export default App`,

        nextjs: `// lib/supabase.js
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

export const supabase = createClient(supabaseUrl, supabaseKey)

// pages/api/users.js
import { supabase } from '../../lib/supabase'

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('users')
      .select('*')
    
    if (error) {
      return res.status(500).json({ error: error.message })
    }
    
    res.status(200).json(data)
  }
}

// pages/index.js
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export default function Home() {
  const [users, setUsers] = useState([])

  useEffect(() => {
    fetchUsers()
  }, [])

  const fetchUsers = async () => {
    const { data } = await supabase.from('users').select('*')
    setUsers(data || [])
  }

  return (
    <div>
      <h1>Next.js + Supabase</h1>
      {users.map(user => (
        <div key={user.id}>{user.email}</div>
      ))}
    </div>
  )
}`
      },

      // Automation example
      automation_example: `// Automation API Example - Execute SQL via REST
const executeSqlCommand = async (sql) => {
  const response = await fetch('http://${EXTERNAL_IP}:3080/api/instances/${instance.id}/execute-sql', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer YOUR_MANAGER_TOKEN'
    },
    body: JSON.stringify({ query: sql })
  })
  
  return await response.json()
}

// Example usage
await executeSqlCommand(\`
  CREATE TABLE posts (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    title text NOT NULL,
    content text,
    author_id uuid REFERENCES auth.users(id),
    created_at timestamp DEFAULT now()
  );
\`)

// Enable RLS
await executeSqlCommand('ALTER TABLE posts ENABLE ROW LEVEL SECURITY;')

// Create policies
await executeSqlCommand(\`
  CREATE POLICY "Users can view own posts" ON posts
    FOR SELECT USING (auth.uid() = author_id);
\`)`
    };

    res.json(config);
  } catch (error) {
    console.error('Erro ao obter configuração do Cursor:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Simple .env configuration for quick copy
 */
app.get('/api/instances/:id/env-config', authenticateToken, checkProjectAccess, async (req, res) => {
  try {
    const instance = manager.instances[req.params.id];
    if (!instance) {
      return res.status(404).json({ error: 'Instância não encontrada' });
    }

    const envContent = `# Ultrabase Supabase Instance - ${instance.name}
NEXT_PUBLIC_SUPABASE_URL=http://${EXTERNAL_IP}:${instance.ports.kong_http}
NEXT_PUBLIC_SUPABASE_ANON_KEY=${instance.credentials.anon_key}
SUPABASE_SERVICE_ROLE_KEY=${instance.credentials.service_role_key}
DATABASE_URL=postgresql://postgres:${instance.credentials.postgres_password}@${EXTERNAL_IP}:${instance.ports.postgres_ext}/postgres`;

    res.json({ env_content: envContent });
  } catch (error) {
    console.error('Erro ao gerar .env:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Framework-specific code templates
 */
app.get('/api/framework-code/:framework', async (req, res) => {
  const { framework } = req.params;
  
  const templates = {
    javascript: `import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
)

export default supabase`,

    typescript: `import { createClient, SupabaseClient } from '@supabase/supabase-js'

const supabase: SupabaseClient = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
)

export default supabase`,

    react: `import { createClient } from '@supabase/supabase-js'

export const supabase = createClient(
  process.env.REACT_APP_SUPABASE_URL,
  process.env.REACT_APP_SUPABASE_ANON_KEY
)`,

    nextjs: `import { createClient } from '@supabase/supabase-js'

export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)`
  };

  const code = templates[framework] || templates.javascript;
  res.json({ code });
});

/**
 * Test connection to instance
 */
app.get('/api/instances/:id/test-connection', authenticateToken, checkProjectAccess, async (req, res) => {
  try {
    const instance = manager.instances[req.params.id];
    if (!instance) {
      return res.status(404).json({ error: 'Instância não encontrada' });
    }

    // Test API endpoint
    const testUrl = `http://${EXTERNAL_IP}:${instance.ports.kong_http}/rest/v1/`;
    const response = await fetch(testUrl, {
      headers: {
        'apikey': instance.credentials.anon_key,
        'Authorization': `Bearer ${instance.credentials.anon_key}`
      }
    });

    if (response.ok) {
      res.json({ 
        success: true, 
        message: `API responding on port ${instance.ports.kong_http}` 
      });
    } else {
      throw new Error(`API returned status ${response.status}`);
    }
  } catch (error) {
    console.error('Erro ao testar conexão:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Quick test with multiple checks
 */
app.get('/api/instances/:id/quick-test', authenticateToken, checkProjectAccess, async (req, res) => {
  try {
    const instance = manager.instances[req.params.id];
    if (!instance) {
      return res.status(404).json({ error: 'Instância não encontrada' });
    }

    const results = [];

    // Test 1: API Health
    try {
      const apiUrl = `http://${EXTERNAL_IP}:${instance.ports.kong_http}/rest/v1/`;
      const apiResponse = await fetch(apiUrl, {
        headers: { 'apikey': instance.credentials.anon_key }
      });
      results.push(apiResponse.ok ? '✅ API endpoint accessible' : '❌ API endpoint failed');
    } catch (error) {
      results.push('❌ API endpoint unreachable');
    }

    // Test 2: Database Connection
    try {
      const { Pool } = require('pg');
      const pool = new Pool({
        host: EXTERNAL_IP,
        port: instance.ports.postgres_ext,
        database: 'postgres',
        user: 'postgres',
        password: instance.credentials.postgres_password,
        connectionTimeoutMillis: 5000,
      });
      
      await pool.query('SELECT 1');
      await pool.end();
      results.push('✅ Database connection successful');
    } catch (error) {
      results.push('❌ Database connection failed');
    }

    // Test 3: Auth endpoint
    try {
      const authUrl = `http://${EXTERNAL_IP}:${instance.ports.kong_http}/auth/v1/health`;
      const authResponse = await fetch(authUrl);
      results.push(authResponse.ok ? '✅ Auth service running' : '❌ Auth service failed');
    } catch (error) {
      results.push('❌ Auth service unreachable');
    }

    res.json({ success: true, results });
  } catch (error) {
    console.error('Erro no teste rápido:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Execute SQL on instance database
 */
app.post('/api/instances/:id/execute-sql', authenticateToken, checkProjectAccess, async (req, res) => {
  try {
    const instance = manager.instances[req.params.id];
    if (!instance) {
      return res.status(404).json({ error: 'Instância não encontrada' });
    }

    const { query } = req.body;
    if (!query) {
      return res.status(400).json({ error: 'Query SQL é obrigatória' });
    }

    const { Pool } = require('pg');
    const pool = new Pool({
      host: EXTERNAL_IP,
      port: instance.ports.postgres_ext,
      database: 'postgres',
      user: 'postgres',
      password: instance.credentials.postgres_password,
      connectionTimeoutMillis: 10000,
    });

    const result = await pool.query(query);
    await pool.end();

    res.json({
      success: true,
      rowCount: result.rowCount,
      rows: result.rows,
      command: result.command
    });
  } catch (error) {
    console.error('Erro ao executar SQL:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Health check with system diagnostics
 */
app.get('/api/health', async (req, res) => {
  try {
    let dockerStatus = false;
    let dockerVersion = 'N/A';
    let dockerComposeVersion = 'N/A';
    
    // Verificar Docker
    try {
      await docker.ping();
      dockerStatus = true;
      const dockerInfo = await execAsync('docker --version');
      dockerVersion = dockerInfo.stdout.trim();
    } catch (error) {
      console.log('Docker não disponível:', error.message);
    }
    
    // Verificar Docker Compose
    try {
      const composeInfo = await execAsync('docker compose version');
      dockerComposeVersion = composeInfo.stdout.trim();
    } catch (error) {
      console.log('Docker Compose não disponível:', error.message);
    }
    
    // Verificar diretório Docker
    const dockerDirExists = await fs.pathExists(CONFIG.DOCKER_DIR);
    
    res.json({ 
      status: 'ok', 
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      system: {
        docker: {
          available: dockerStatus,
          version: dockerVersion
        },
        docker_compose: {
          version: dockerComposeVersion
        },
        directories: {
          docker_dir: {
            path: CONFIG.DOCKER_DIR,
            exists: dockerDirExists
          }
        },
        instances: {
          total: Object.keys(manager.instances).length,
          max_allowed: CONFIG.MAX_INSTANCES
        }
      }
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: error.message
    });
  }
});

/**
 * Rota de configuração - mostra configurações atuais do sistema
 */
app.get('/api/config', (req, res) => {
  try {
    res.json({
      status: 'ok',
      configuration: {
        external_ip: EXTERNAL_IP,
        manager_port: PORT,
        docker_dir: CONFIG.DOCKER_DIR,
        port_ranges: CONFIG.PORT_RANGE,
        max_instances: CONFIG.MAX_INSTANCES,
        instances_count: Object.keys(manager.instances).length
      },
      environment: {
        VPS_HOST: process.env.VPS_HOST || 'not_set',
        MANAGER_EXTERNAL_IP: process.env.MANAGER_EXTERNAL_IP || 'not_set',
        NODE_ENV: process.env.NODE_ENV || 'development'
      },
      sample_urls: {
        studio: `http://${EXTERNAL_IP}:8100`,
        api: `http://${EXTERNAL_IP}:8100`,
        database: `postgresql://postgres:password@${EXTERNAL_IP}:5500/postgres`
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Teste de geração de JWT (apenas para debug)
 */
app.get('/api/test-jwt', (req, res) => {
  try {
    console.log('🧪 Testando geração de JWT...');
    
    const testSecret = manager.generateJWTSecret();
    const anonToken = manager.generateSupabaseKey('anon', testSecret);
    const serviceToken = manager.generateSupabaseKey('service_role', testSecret);
    
    const anonDecoded = manager.validateSupabaseKey(anonToken, testSecret);
    const serviceDecoded = manager.validateSupabaseKey(serviceToken, testSecret);
    
    res.json({
      status: 'ok',
      jwt_generation: 'working',
      test_results: {
        anon_key: {
          token: anonToken,
          valid: !!anonDecoded,
          decoded: anonDecoded
        },
        service_role_key: {
          token: serviceToken,
          valid: !!serviceDecoded,
          decoded: serviceDecoded
        }
      }
    });
  } catch (error) {
    console.error('❌ Erro no teste JWT:', error);
    res.status(500).json({ 
      status: 'error', 
      message: error.message 
    });
  }
});

// Inicialização do servidor
async function startServer() {
  let dockerAvailable = false;
  
  try {
    // Verificar se Docker está disponível
    try {
      await docker.ping();
      dockerAvailable = true;
      console.log('✅ Docker conectado com sucesso');
    } catch (dockerError) {
      console.warn('⚠️  Docker não está disponível:', dockerError.message);
      console.warn('⚠️  O servidor iniciará em modo limitado (apenas visualização)');
    }

    // Verificar se diretório docker existe
    if (!await fs.pathExists(CONFIG.DOCKER_DIR)) {
      console.warn(`⚠️  Diretório Docker não encontrado: ${CONFIG.DOCKER_DIR}`);
      console.warn('⚠️  Funcionalidade de criação de instâncias será limitada');
    } else {
      console.log('✅ Diretório Docker encontrado');
    }

    // Iniciar servidor mesmo sem Docker
    app.listen(PORT, () => {
      console.log(`
🚀 SUPABASE INSTANCE MANAGER
   
   Dashboard: http://localhost:${PORT}
   API: http://localhost:${PORT}/api
   
   Docker Status: ${dockerAvailable ? '✅ Conectado' : '❌ Indisponível'}
   Instâncias salvas: ${Object.keys(manager.instances).length}
   Portas disponíveis: ${Object.values(CONFIG.PORT_RANGE).reduce((acc, range) => acc + (range.max - range.min + 1), 0)}
   
   ${dockerAvailable ? 'Pronto para criar projetos Supabase! 🎉' : 'Inicie o Docker para criar novos projetos 🐳'}
      `);
    });

  } catch (error) {
    console.error('❌ Erro ao inicializar servidor:', error.message);
    console.error('💡 Sugestões:');
    console.error('   - Verifique se a porta 3080 está livre');
    console.error('   - Execute o comando como administrador se necessário');
    process.exit(1);
  }
}

// Tratamento de erros não capturados
process.on('uncaughtException', (error) => {
  console.error('❌ Erro não capturado:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Promise rejeitada não tratada:', reason);
  process.exit(1);
});

// Iniciar servidor
startServer();