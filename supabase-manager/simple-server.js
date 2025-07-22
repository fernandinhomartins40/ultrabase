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

// Listar projetos - SIMPLIFICADO
app.get('/api/instances', (req, res) => {
  res.json({ instances: [], message: 'Listagem não implementada na versão simples' });
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor simples rodando na porta ${PORT}`);
});