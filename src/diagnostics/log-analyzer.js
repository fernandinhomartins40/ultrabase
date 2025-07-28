/**
 * LOG ANALYZER - Sistema de análise de logs estruturados
 * 
 * Analisa logs dos containers Supabase de forma estruturada:
 * - Coleta logs via Docker
 * - Filtra por serviço e nível
 * - Identifica padrões de erro
 * - Correlaciona problemas entre serviços
 */

const Docker = require('dockerode');
const { execAsync } = require('util').promisify(require('child_process').exec);

class LogAnalyzer {
  constructor(config) {
    this.docker = new Docker();
    this.config = config;
    this.logLevels = {
      'error': 0,
      'warn': 1,
      'warning': 1,
      'info': 2,
      'debug': 3
    };
  }

  /**
   * Obtém logs estruturados de uma instância
   */
  async getStructuredLogs(instanceId, options = {}) {
    try {
      console.log(`📋 Analisando logs da instância ${instanceId}`);
      
      const {
        services = ['auth', 'rest', 'db', 'kong', 'studio'],
        level = 'error',
        timeRange = '1h',
        maxLines = 500
      } = options;

      const containerMapping = {
        'auth': `supabase-auth-${instanceId}`,
        'rest': `supabase-rest-${instanceId}`,
        'db': `supabase-db-${instanceId}`,
        'kong': `supabase-kong-${instanceId}`,
        'studio': `supabase-studio-${instanceId}`,
        'storage': `supabase-storage-${instanceId}`,
        'realtime': `realtime-dev.supabase-realtime-${instanceId}`,
        'analytics': `supabase-analytics-${instanceId}`
      };

      const allLogs = [];
      const logSummary = {
        total_entries: 0,
        error_count: 0,
        warning_count: 0,
        services_analyzed: [],
        time_range: timeRange,
        level_filter: level
      };

      for (const service of services) {
        const containerName = containerMapping[service];
        if (!containerName) {
          console.warn(`⚠️ Serviço desconhecido: ${service}`);
          continue;
        }

        try {
          const serviceLogs = await this.getContainerLogs(containerName, {
            since: this.parseTimeRange(timeRange),
            tail: Math.floor(maxLines / services.length)
          });

          const parsedLogs = this.parseServiceLogs(service, serviceLogs);
          const filteredLogs = this.filterLogsByLevel(parsedLogs, level);

          allLogs.push(...filteredLogs);
          logSummary.services_analyzed.push(service);

          // Contar por nível
          filteredLogs.forEach(log => {
            if (['error', 'fatal', 'panic'].includes(log.level.toLowerCase())) {
              logSummary.error_count++;
            } else if (['warn', 'warning'].includes(log.level.toLowerCase())) {
              logSummary.warning_count++;
            }
          });

        } catch (serviceError) {
          console.warn(`⚠️ Erro ao obter logs do ${service}:`, serviceError.message);
          
          // Adicionar log de erro do próprio analisador
          allLogs.push({
            timestamp: new Date().toISOString(),
            service: service,
            level: 'error',
            message: `Failed to retrieve logs: ${serviceError.message}`,
            source: 'log-analyzer',
            container: containerName
          });
          logSummary.error_count++;
        }
      }

      // Ordenar logs por timestamp
      allLogs.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
      logSummary.total_entries = allLogs.length;

      // Identificar padrões de erro
      const errorPatterns = this.identifyErrorPatterns(allLogs);

      return {
        logs: allLogs,
        summary: logSummary,
        error_patterns: errorPatterns,
        generated_at: new Date().toISOString()
      };

    } catch (error) {
      console.error(`❌ Erro na análise de logs:`, error);
      return {
        logs: [],
        summary: {
          total_entries: 0,
          error_count: 1,
          warning_count: 0,
          services_analyzed: [],
          time_range: options.timeRange || '1h',
          level_filter: options.level || 'error'
        },
        error_patterns: [],
        error: error.message,
        generated_at: new Date().toISOString()
      };
    }
  }

  /**
   * Obtém logs de um container específico
   */
  async getContainerLogs(containerName, options = {}) {
    try {
      const containers = await this.docker.listContainers({
        all: true,
        filters: { name: [containerName] }
      });

      if (containers.length === 0) {
        throw new Error(`Container ${containerName} não encontrado`);
      }

      const container = this.docker.getContainer(containers[0].Id);
      
      const logOptions = {
        stdout: true,
        stderr: true,
        timestamps: true,
        since: options.since || Math.floor(Date.now() / 1000) - 3600, // 1 hora atrás
        tail: options.tail || 100
      };

      const logStream = await container.logs(logOptions);
      const logString = logStream.toString('utf8');

      return this.cleanDockerLogs(logString);

    } catch (error) {
      console.error(`❌ Erro ao obter logs do container ${containerName}:`, error);
      throw error;
    }
  }

  /**
   * Limpa logs do Docker (remove headers de stream)
   */
  cleanDockerLogs(rawLogs) {
    if (!rawLogs || rawLogs.length === 0) {
      return '';
    }

    // Docker logs têm headers de 8 bytes, vamos limpar isso
    const lines = rawLogs.split('\n');
    const cleanedLines = lines.map(line => {
      // Remove caracteres de controle e headers do Docker
      return line.replace(/^\x01\x00\x00\x00\x00\x00\x00./, '')
                 .replace(/^\x02\x00\x00\x00\x00\x00\x00./, '')
                 .replace(/^[\x00-\x1f]+/, '')
                 .trim();
    }).filter(line => line.length > 0);

    return cleanedLines.join('\n');
  }

  /**
   * Analisa logs específicos de cada serviço
   */
  parseServiceLogs(service, rawLogs) {
    const lines = rawLogs.split('\n').filter(line => line.trim().length > 0);
    const parsedLogs = [];

    for (const line of lines) {
      try {
        const parsedLog = this.parseLogLine(service, line);
        if (parsedLog) {
          parsedLogs.push(parsedLog);
        }
      } catch (parseError) {
        // Se não conseguir fazer parse, criar entrada básica
        parsedLogs.push({
          timestamp: new Date().toISOString(),
          service: service,
          level: 'info',
          message: line,
          raw: line,
          parse_error: parseError.message
        });
      }
    }

    return parsedLogs;
  }

  /**
   * Faz parse de uma linha de log específica por serviço
   */
  parseLogLine(service, line) {
    if (!line || line.trim().length === 0) return null;

    let parsed = {
      timestamp: null,
      service: service,
      level: 'info',
      message: '',
      raw: line
    };

    // Tentar extrair timestamp do Docker
    const dockerTimestampMatch = line.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z)\s+(.*)$/);
    if (dockerTimestampMatch) {
      parsed.timestamp = dockerTimestampMatch[1];
      line = dockerTimestampMatch[2];
    }

    switch (service) {
      case 'auth':
        return this.parseGoTrueLogs(line, parsed);
      
      case 'rest':
        return this.parsePostgRESTLogs(line, parsed);
      
      case 'db':
        return this.parsePostgreSQLLogs(line, parsed);
      
      case 'kong':
        return this.parseKongLogs(line, parsed);
      
      case 'studio':
        return this.parseStudioLogs(line, parsed);
      
      default:
        parsed.message = line;
        return parsed;
    }
  }

  /**
   * Parse específico para logs do GoTrue (Auth)
   */
  parseGoTrueLogs(line, parsed) {
    try {
      // GoTrue usa JSON estruturado
      const jsonMatch = line.match(/\{.*\}/);
      if (jsonMatch) {
        const logData = JSON.parse(jsonMatch[0]);
        
        parsed.level = logData.level || 'info';
        parsed.message = logData.msg || logData.message || line;
        parsed.timestamp = parsed.timestamp || logData.time || new Date().toISOString();
        
        // Campos específicos do GoTrue
        if (logData.error) parsed.error = logData.error;
        if (logData.user_id) parsed.user_id = logData.user_id;
        if (logData.email) parsed.email = logData.email;
        if (logData.component) parsed.component = logData.component;
        
        return parsed;
      }
    } catch (jsonError) {
      // Não é JSON, tentar regex
    }

    // Fallback para logs de texto
    const levelMatch = line.match(/\b(FATAL|ERROR|WARN|INFO|DEBUG)\b/i);
    if (levelMatch) {
      parsed.level = levelMatch[1].toLowerCase();
    }

    // Procurar por erros comuns do GoTrue
    if (line.includes('database connection') || line.includes('connection refused')) {
      parsed.level = 'error';
      parsed.category = 'database_connection';
    } else if (line.includes('failed to create user') || line.includes('signup')) {
      parsed.level = 'error';
      parsed.category = 'user_creation';
    } else if (line.includes('JWT') || line.includes('token')) {
      parsed.category = 'authentication';
    }

    parsed.message = line;
    parsed.timestamp = parsed.timestamp || new Date().toISOString();
    return parsed;
  }

  /**
   * Parse específico para logs do PostgREST
   */
  parsePostgRESTLogs(line, parsed) {
    // PostgREST formato: timestamp: message
    const restMatch = line.match(/^(\d{2}\/\w{3}\/\d{4}:\d{2}:\d{2}:\d{2} [+-]\d{4}):\s*(.*)$/);
    if (restMatch) {
      try {
        parsed.timestamp = new Date(restMatch[1]).toISOString();
      } catch (dateError) {
        parsed.timestamp = parsed.timestamp || new Date().toISOString();
      }
      parsed.message = restMatch[2];
    } else {
      parsed.message = line;
      parsed.timestamp = parsed.timestamp || new Date().toISOString();
    }

    // Identificar nível por padrões
    if (line.includes('ERROR') || line.includes('FATAL')) {
      parsed.level = 'error';
    } else if (line.includes('WARNING')) {
      parsed.level = 'warning';
    }

    // Categorias específicas
    if (line.includes('connection to database')) {
      parsed.category = 'database_connection';
    } else if (line.includes('JWT')) {
      parsed.category = 'authentication';
    }

    return parsed;
  }

  /**
   * Parse específico para logs do PostgreSQL
   */
  parsePostgreSQLLogs(line, parsed) {
    // PostgreSQL formato complexo
    const pgMatch = line.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3} UTC) \[(\d+)\] (\w+):\s*(.*)$/);
    if (pgMatch) {
      try {
        parsed.timestamp = new Date(pgMatch[1]).toISOString();
      } catch (dateError) {
        parsed.timestamp = parsed.timestamp || new Date().toISOString();
      }
      parsed.level = pgMatch[3].toLowerCase();
      parsed.message = pgMatch[4];
      parsed.pid = pgMatch[2];
    } else {
      parsed.message = line;
      parsed.timestamp = parsed.timestamp || new Date().toISOString();
      
      // Tentar extrair nível
      const levelMatch = line.match(/\b(FATAL|ERROR|WARNING|NOTICE|INFO|LOG|DEBUG)\b/i);
      if (levelMatch) {
        parsed.level = levelMatch[1].toLowerCase();
        if (parsed.level === 'log') parsed.level = 'info';
      }
    }

    // Categorias específicas do PostgreSQL
    if (line.includes('connection') && line.includes('refused')) {
      parsed.category = 'connection_error';
    } else if (line.includes('authentication failed')) {
      parsed.category = 'auth_failed';
    } else if (line.includes('database') && line.includes('does not exist')) {
      parsed.category = 'database_missing';
    }

    return parsed;
  }

  /**
   * Parse específico para logs do Kong
   */
  parseKongLogs(line, parsed) {
    // Kong pode ter formato de nginx ou JSON
    try {
      const jsonMatch = line.match(/\{.*\}/);
      if (jsonMatch) {
        const logData = JSON.parse(jsonMatch[0]);
        parsed.level = logData.level || 'info';
        parsed.message = logData.message || logData.msg || line;
        return parsed;
      }
    } catch (jsonError) {
      // Não é JSON
    }

    // Nginx format para Kong
    const nginxMatch = line.match(/^(\d+\.\d+\.\d+\.\d+) - - \[([^\]]+)\] "(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS) ([^"]*)" (\d+) (\d+) "([^"]*)" "([^"]*)"/);
    if (nginxMatch) {
      parsed.message = `${nginxMatch[3]} ${nginxMatch[4]} - ${nginxMatch[5]}`;
      parsed.level = parseInt(nginxMatch[5]) >= 400 ? 'error' : 'info';
      parsed.ip = nginxMatch[1];
      parsed.method = nginxMatch[3];
      parsed.path = nginxMatch[4];
      parsed.status_code = parseInt(nginxMatch[5]);
      parsed.timestamp = parsed.timestamp || new Date().toISOString();
      return parsed;
    }

    // Fallback
    parsed.message = line;
    parsed.timestamp = parsed.timestamp || new Date().toISOString();
    
    if (line.includes('ERROR') || line.includes('error')) {
      parsed.level = 'error';
    }

    return parsed;
  }

  /**
   * Parse específico para logs do Studio
   */
  parseStudioLogs(line, parsed) {
    // Studio (Next.js) logs
    parsed.message = line;
    parsed.timestamp = parsed.timestamp || new Date().toISOString();

    // Identificar padrões
    if (line.includes('Error') || line.includes('ERROR')) {
      parsed.level = 'error';
    } else if (line.includes('Warning') || line.includes('WARN')) {
      parsed.level = 'warning';
    }

    // Categorias
    if (line.includes('API') || line.includes('fetch')) {
      parsed.category = 'api_call';
    } else if (line.includes('compile') || line.includes('build')) {
      parsed.category = 'build';
    }

    return parsed;
  }

  /**
   * Filtra logs por nível de severidade
   */
  filterLogsByLevel(logs, minLevel) {
    const minLevelValue = this.logLevels[minLevel.toLowerCase()] || 0;
    
    return logs.filter(log => {
      const logLevelValue = this.logLevels[log.level.toLowerCase()] || 2;
      return logLevelValue <= minLevelValue;
    });
  }

  /**
   * Converte range de tempo para timestamp Unix
   */
  parseTimeRange(timeRange) {
    const now = Math.floor(Date.now() / 1000);
    
    const ranges = {
      '15m': 15 * 60,
      '30m': 30 * 60,
      '1h': 60 * 60,
      '2h': 2 * 60 * 60,
      '6h': 6 * 60 * 60,
      '12h': 12 * 60 * 60,
      '24h': 24 * 60 * 60,
      '1d': 24 * 60 * 60
    };

    const seconds = ranges[timeRange] || ranges['1h'];
    return now - seconds;
  }

  /**
   * Identifica padrões comuns de erro
   */
  identifyErrorPatterns(logs) {
    const patterns = [];
    const errorLogs = logs.filter(log => ['error', 'fatal', 'panic'].includes(log.level.toLowerCase()));

    if (errorLogs.length === 0) {
      return patterns;
    }

    // Padrão 1: Problemas de conexão com banco
    const dbConnectionErrors = errorLogs.filter(log => 
      log.message.toLowerCase().includes('connection') && 
      (log.message.toLowerCase().includes('database') || log.message.toLowerCase().includes('postgres'))
    );

    if (dbConnectionErrors.length > 0) {
      patterns.push({
        pattern: 'database_connection_issues',
        description: 'Problemas de conexão com o banco de dados',
        count: dbConnectionErrors.length,
        services: [...new Set(dbConnectionErrors.map(log => log.service))],
        sample_message: dbConnectionErrors[0].message,
        severity: 'high'
      });
    }

    // Padrão 2: Problemas de autenticação/GoTrue
    const authErrors = errorLogs.filter(log => 
      log.service === 'auth' || 
      log.message.toLowerCase().includes('jwt') ||
      log.message.toLowerCase().includes('user') ||
      log.message.toLowerCase().includes('signup') ||
      log.message.toLowerCase().includes('authentication')
    );

    if (authErrors.length > 0) {
      patterns.push({
        pattern: 'authentication_issues',
        description: 'Problemas no sistema de autenticação (GoTrue)',
        count: authErrors.length,
        services: [...new Set(authErrors.map(log => log.service))],
        sample_message: authErrors[0].message,
        severity: 'high'
      });
    }

    // Padrão 3: Problemas de API/HTTP
    const apiErrors = errorLogs.filter(log => 
      log.status_code >= 500 || 
      log.message.toLowerCase().includes('api') ||
      log.message.toLowerCase().includes('http') ||
      log.message.toLowerCase().includes('timeout')
    );

    if (apiErrors.length > 0) {
      patterns.push({
        pattern: 'api_http_issues',
        description: 'Problemas de API/HTTP',
        count: apiErrors.length,
        services: [...new Set(apiErrors.map(log => log.service))],
        sample_message: apiErrors[0].message,
        severity: 'medium'
      });
    }

    // Padrão 4: Muitos erros do mesmo serviço
    const serviceErrorCounts = {};
    errorLogs.forEach(log => {
      serviceErrorCounts[log.service] = (serviceErrorCounts[log.service] || 0) + 1;
    });

    Object.entries(serviceErrorCounts).forEach(([service, count]) => {
      if (count >= 5) {
        patterns.push({
          pattern: 'service_error_spike',
          description: `Alto número de erros no serviço ${service}`,
          count: count,
          services: [service],
          sample_message: errorLogs.find(log => log.service === service).message,
          severity: count >= 10 ? 'high' : 'medium'
        });
      }
    });

    return patterns;
  }

  /**
   * Obtém resumo de logs recentes para diagnóstico rápido
   */
  async getRecentLogsSummary(instanceId, minutes = 30) {
    try {
      const logs = await this.getStructuredLogs(instanceId, {
        services: ['auth', 'rest', 'db', 'kong'],
        level: 'warning',
        timeRange: `${minutes}m`,
        maxLines: 100
      });

      return {
        period_minutes: minutes,
        total_entries: logs.summary.total_entries,
        error_count: logs.summary.error_count,
        warning_count: logs.summary.warning_count,
        critical_errors: logs.logs.filter(log => log.level === 'error').slice(0, 5),
        error_patterns: logs.error_patterns
      };

    } catch (error) {
      console.error(`❌ Erro ao obter resumo de logs:`, error);
      return {
        period_minutes: minutes,
        total_entries: 0,
        error_count: 1,
        warning_count: 0,
        critical_errors: [{
          timestamp: new Date().toISOString(),
          service: 'log-analyzer',
          level: 'error',
          message: `Failed to analyze logs: ${error.message}`
        }],
        error_patterns: []
      };
    }
  }
}

module.exports = LogAnalyzer;