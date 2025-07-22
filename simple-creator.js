#!/usr/bin/env node

/**
 * CRIADOR SIMPLES DE INSTÂNCIAS SUPABASE
 * 
 * Executa diretamente o generate.bash sem complexidade desnecessária
 */

const express = require('express');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);
const app = express();
const PORT = 3080;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public-simple')));

// Endpoint para criar projeto - apenas executa generate.bash
app.post('/create', async (req, res) => {
  const { projectName, organization } = req.body;
  
  if (!projectName) {
    return res.status(400).json({ error: 'Nome do projeto é obrigatório' });
  }
  
  console.log(`🚀 Criando projeto: ${projectName}`);
  
  try {
    const dockerDir = path.join(__dirname, '..', 'docker');
    
    // Executar generate.bash diretamente
    const command = `cd "${dockerDir}" && bash generate.bash`;
    const { stdout, stderr } = await execAsync(command, {
      timeout: 900000, // 15 minutos
      env: {
        ...process.env,
        PROJECT_NAME: projectName,
        ORGANIZATION_NAME: organization || 'Default Organization'
      }
    });
    
    console.log('✅ Projeto criado com sucesso!');
    console.log('Output:', stdout);
    
    res.json({
      success: true,
      message: `Projeto "${projectName}" criado com sucesso!`,
      output: stdout
    });
    
  } catch (error) {
    console.error('❌ Erro ao criar projeto:', error);
    res.status(500).json({
      error: 'Erro ao criar projeto',
      details: error.message
    });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.listen(PORT, () => {
  console.log(`🚀 Criador simples rodando em http://localhost:${PORT}`);
});