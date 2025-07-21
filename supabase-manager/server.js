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

const execAsync = promisify(exec);
const docker = new Docker();
const app = express();
const PORT = process.env.MANAGER_PORT || 3080;

// Middleware - CSP mais permissivo para desenvolvimento
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
      scriptSrcAttr: ["'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:", "http:"],
      fontSrc: ["'self'", "https://cdnjs.cloudflare.com", "data:"],
      connectSrc: ["'self'", "http:", "https:"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'self'"],
    },
  },
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
app.use(express.static(path.join(__dirname, 'public')));

// Logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.url}`);
  next();
});

// Configurações do sistema
const CONFIG = {
  DOCKER_DIR: path.join(__dirname, '..', 'docker'),
  INSTANCES_FILE: path.join(__dirname, 'instances.json'),
  PORT_RANGE: {
    KONG_HTTP: { min: 8100, max: 8199 },
    KONG_HTTPS: { min: 8400, max: 8499 },
    POSTGRES_EXT: { min: 5500, max: 5599 },
    ANALYTICS: { min: 4100, max: 4199 }
  },
  MAX_INSTANCES: 50,
  BASE_NETWORK: '172.20.0.0/16'
};

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
        return JSON.parse(data);
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

    // Gerar portas únicas
    const ports = {
      kong_http: this.generateAvailablePort('kong_http'),
      kong_https: this.generateAvailablePort('kong_https'),
      postgres_ext: this.generateAvailablePort('postgres_ext'),
      analytics: this.generateAvailablePort('analytics')
    };

    // Gerar credenciais únicas
    const credentials = {
      postgres_password: this.generateSecurePassword(),
      jwt_secret: this.generateJWTSecret(),
      anon_key: this.generateSupabaseKey('anon', timestamp),
      service_role_key: this.generateSupabaseKey('service_role', timestamp),
      dashboard_username: 'admin',
      dashboard_password: this.generateSecurePassword(12),
      vault_enc_key: this.generateSecurePassword(32),
      logflare_api_key: this.generateSecurePassword(24)
    };

    return {
      id: instanceId,
      name: projectName,
      status: 'creating',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      ports,
      credentials,
      urls: {
        studio: `http://localhost:${ports.kong_http}`,
        api: `http://localhost:${ports.kong_http}`,
        db: `postgresql://postgres:${credentials.postgres_password}@localhost:${ports.postgres_ext}/postgres`
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
   * Simulação simplificada - em produção usar biblioteca JWT adequada
   */
  generateSupabaseKey(role, timestamp) {
    // Esta é uma implementação simplificada
    // Em produção, usar uma biblioteca JWT adequada para gerar tokens válidos
    const payload = {
      role: role,
      iss: 'supabase-manager',
      iat: Math.floor(timestamp / 1000),
      exp: Math.floor(timestamp / 1000) + (365 * 24 * 60 * 60) // 1 ano
    };
    
    // Simulação de token JWT (em produção usar jsonwebtoken library)
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return `${header}.${payloadB64}.signature_placeholder`;
  }

  /**
   * Lista todas as instâncias
   */
  async listInstances() {
    try {
      console.log('📋 Listando instâncias...');
      console.log('Instâncias carregadas:', Object.keys(this.instances).length);
      
      // Verificar se Docker está disponível
      try {
        await docker.ping();
        console.log('✅ Docker está disponível');
      } catch (dockerError) {
        console.warn('⚠️ Docker não está disponível:', dockerError.message);
        // Continuar mesmo sem Docker para mostrar instâncias salvas
      }
      
      // Atualizar status das instâncias verificando containers
      const instances = Object.values(this.instances);
      for (const instance of instances) {
        try {
          instance.status = await this.getInstanceStatus(instance);
        } catch (statusError) {
          console.warn(`⚠️ Erro ao verificar status da instância ${instance.id}:`, statusError.message);
          // Manter status anterior ou definir como error
          instance.status = instance.status || 'error';
        }
      }
      
      const result = {
        instances: instances,
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
      // Verificar se Docker está disponível
      await docker.ping();
      
      const containers = await docker.listContainers({ 
        all: true, 
        filters: { name: [`supabase-studio-${instance.id}`] } 
      });
      
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
   * Cria nova instância Supabase
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

      // Gerar configuração
      console.log('⚙️ Gerando configuração da instância...');
      instance = this.generateInstanceConfig(projectName, customConfig);
      
      // Definir status como 'creating'
      instance.status = 'creating';
      
      // Salvar instância
      this.instances[instance.id] = instance;
      this.saveInstances();
      
      console.log(`💾 Instância ${instance.id} salva com status 'creating'`);

      // Criar arquivos de configuração
      console.log('📁 Criando arquivos de configuração...');
      await this.createInstanceFiles(instance);
      
      // Iniciar containers
      console.log('🐳 Iniciando containers Docker...');
      await this.startInstanceContainers(instance);
      
      // Aguardar um pouco para containers iniciarem
      console.log('⏳ Aguardando inicialização dos containers...');
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      // Atualizar status
      instance.status = 'running';
      instance.updated_at = new Date().toISOString();
      this.saveInstances();

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
   * Cria arquivos de configuração da instância
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

SITE_URL=http://localhost:3000
ADDITIONAL_REDIRECT_URLS=
JWT_EXPIRY=3600
DISABLE_SIGNUP=false
API_EXTERNAL_URL=http://localhost:${ports.kong_http}

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
SUPABASE_PUBLIC_URL=http://localhost:${ports.kong_http}

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

      const command = `cd "${dockerDir}" && docker compose -f "${instance.docker.compose_file}" --env-file "${instance.docker.env_file}" up -d`;
      
      const { stdout, stderr } = await execAsync(command);
      
      if (stderr && !stderr.includes('Creating') && !stderr.includes('Starting')) {
        console.error('Docker stderr:', stderr);
        throw new Error(`Erro ao iniciar containers: ${stderr}`);
      }

      console.log('Docker stdout:', stdout);
      console.log(`✅ Containers iniciados para instância ${instance.id}`);

    } catch (error) {
      throw new Error(`Erro ao iniciar containers: ${error.message}`);
    }
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

// Instância global do gerenciador
const manager = new SupabaseInstanceManager();

// Rotas da API

/**
 * Rota principal - serve o dashboard
 */
app.get('/', (req, res) => {
  console.log('🏠 Serving dashboard');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

/**
 * Lista todas as instâncias
 */
app.get('/api/instances', async (req, res) => {
  try {
    console.log('📎 GET /api/instances - Listando instâncias...');
    const data = await manager.listInstances();
    console.log('📎 Respondendo com', data.instances.length, 'instâncias');
    res.json(data);
  } catch (error) {
    console.error('❌ Erro ao listar instâncias:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Cria nova instância
 */
app.post('/api/instances', async (req, res) => {
  try {
    console.log('🚀 POST /api/instances - Criando nova instância...');
    console.log('Body recebido:', req.body);
    
    const { projectName, config = {} } = req.body;
    
    if (!projectName) {
      console.log('❌ Nome do projeto não fornecido');
      return res.status(400).json({ error: 'Nome do projeto é obrigatório' });
    }

    console.log(`🏠 Criando projeto: ${projectName}`);
    const result = await manager.createInstance(projectName, config);
    console.log('✅ Projeto criado com sucesso:', result.instance.id);
    res.json(result);
  } catch (error) {
    console.error('❌ Erro ao criar instância:', error);
    res.status(400).json({ error: error.message });
  }
});

/**
 * Para uma instância
 */
app.post('/api/instances/:id/stop', async (req, res) => {
  try {
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
app.post('/api/instances/:id/start', async (req, res) => {
  try {
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
app.delete('/api/instances/:id', async (req, res) => {
  try {
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
app.get('/api/instances/:id', async (req, res) => {
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
app.get('/api/instances/:id/logs', async (req, res) => {
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
 * Health check
 */
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

// Inicialização do servidor
async function startServer() {
  try {
    // Verificar se Docker está disponível
    await docker.ping();
    console.log('✅ Docker conectado com sucesso');

    // Verificar se diretório docker existe
    if (!await fs.pathExists(CONFIG.DOCKER_DIR)) {
      throw new Error(`Diretório Docker não encontrado: ${CONFIG.DOCKER_DIR}`);
    }
    console.log('✅ Diretório Docker encontrado');

    // Iniciar servidor
    app.listen(PORT, () => {
      console.log(`
🚀 SUPABASE INSTANCE MANAGER
   
   Dashboard: http://localhost:${PORT}
   API: http://localhost:${PORT}/api
   
   Instâncias ativas: ${Object.keys(manager.instances).length}
   Portas disponíveis: ${Object.values(CONFIG.PORT_RANGE).reduce((acc, range) => acc + (range.max - range.min + 1), 0)}
   
   Pronto para criar projetos Supabase! 🎉
      `);
    });

  } catch (error) {
    console.error('❌ Erro ao inicializar servidor:', error.message);
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