#!/usr/bin/env node

const express = require('express');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);
const app = express();
const PORT = 3080;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', simple: true });
});

// Criar projeto - EXECUTA GENERATE.BASH DIRETAMENTE
app.post('/api/instances', async (req, res) => {
  const { projectName, config } = req.body;
  
  if (!projectName) {
    return res.status(400).json({ error: 'Nome do projeto é obrigatório' });
  }
  
  console.log(`🚀 CRIAÇÃO SIMPLES: ${projectName}`);
  
  try {
    const dockerDir = path.join(__dirname, '..', 'docker');
    const organization = config?.organization || 'Default Organization';
    
    console.log('🔧 Executando generate.bash...');
    
    const command = `cd "${dockerDir}" && bash generate.bash`;
    const { stdout, stderr } = await execAsync(command, {
      timeout: 900000, // 15 minutos
      env: {
        ...process.env,
        PROJECT_NAME: projectName,
        ORGANIZATION_NAME: organization
      }
    });
    
    console.log('✅ Projeto criado!');
    
    res.json({
      success: true,
      message: `Projeto "${projectName}" criado com sucesso!`,
      output: stdout
    });
    
  } catch (error) {
    console.error('❌ Erro:', error);
    res.status(500).json({
      error: 'Erro ao criar projeto',
      details: error.message
    });
  }
});

// Listar projetos - LÊ ARQUIVOS DO GENERATE.BASH
app.get('/api/instances', async (req, res) => {
  try {
    const dockerDir = path.join(__dirname, '..', 'docker');
    const fs = require('fs').promises;
    
    // Buscar todos os arquivos .env-* criados pelo generate.bash
    const files = await fs.readdir(dockerDir);
    const envFiles = files.filter(f => f.startsWith('.env-') && f !== '.env-template');
    
    console.log(`📋 Encontrados ${envFiles.length} projetos`);
    
    const instances = [];
    
    for (const envFile of envFiles) {
      try {
        const envPath = path.join(dockerDir, envFile);
        const envContent = await fs.readFile(envPath, 'utf8');
        
        // Extrair informações do arquivo .env
        const instanceId = envFile.replace('.env-', '');
        const projectName = extractEnvVar(envContent, 'PROJECT_NAME') || `projeto-${instanceId}`;
        const kongPort = extractEnvVar(envContent, 'KONG_HTTP_PORT');
        const pgPort = extractEnvVar(envContent, 'POSTGRES_PORT_EXT');
        
        if (kongPort) {
          instances.push({
            id: instanceId,
            name: projectName,
            status: 'running',
            studio_url: `http://82.25.69.57:${kongPort}`,
            ports: {
              kong_http: parseInt(kongPort),
              postgres_ext: parseInt(pgPort)
            },
            created_from: 'generate.bash'
          });
        }
      } catch (error) {
        console.error(`Erro ao processar ${envFile}:`, error.message);
      }
    }
    
    console.log(`✅ Listados ${instances.length} projetos ativos`);
    res.json({ instances, total: instances.length });
    
  } catch (error) {
    console.error('❌ Erro ao listar projetos:', error);
    res.status(500).json({ error: 'Erro ao listar projetos', details: error.message });
  }
});

// Função para extrair variáveis do arquivo .env
function extractEnvVar(content, varName) {
  const regex = new RegExp(`^${varName}=(.*)$`, 'm');
  const match = content.match(regex);
  return match ? match[1].trim().replace(/['"]/g, '') : null;
}

app.listen(PORT, () => {
  console.log(`🚀 Servidor simples rodando na porta ${PORT}`);
});