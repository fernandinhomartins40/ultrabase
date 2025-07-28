const fs = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');

class DiagnosticHistory {
  constructor() {
    this.historyFile = path.join(__dirname, 'diagnostic-history.json');
    this.maxHistoryEntries = 100; // Por instância
  }

  async saveDiagnostic(instanceId, diagnostic) {
    try {
      const history = await this.loadHistory();
      
      if (!history[instanceId]) {
        history[instanceId] = [];
      }
      
      // Adicionar novo diagnóstico
      history[instanceId].unshift({
        ...diagnostic,
        id: uuidv4().substring(0, 8),
        saved_at: new Date().toISOString()
      });
      
      // Limitar histórico
      if (history[instanceId].length > this.maxHistoryEntries) {
        history[instanceId] = history[instanceId].slice(0, this.maxHistoryEntries);
      }
      
      await this.saveHistory(history);
      console.log(`📊 Diagnóstico salvo no histórico para instância ${instanceId}`);
    } catch (error) {
      console.error(`❌ Erro ao salvar diagnóstico no histórico:`, error);
    }
  }

  async loadHistory() {
    try {
      const data = await fs.readFile(this.historyFile, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      if (error.code === 'ENOENT') {
        return {};
      }
      throw error;
    }
  }

  async saveHistory(history) {
    await fs.writeFile(this.historyFile, JSON.stringify(history, null, 2));
  }

  async getInstanceHistory(instanceId, limit = 10) {
    const history = await this.loadHistory();
    const instanceHistory = history[instanceId] || [];
    
    return instanceHistory.slice(0, limit);
  }

  async generateHealthReport(instanceId, days = 7) {
    const history = await this.loadHistory();
    const instanceHistory = history[instanceId] || [];
    
    const cutoffDate = new Date(Date.now() - (days * 24 * 60 * 60 * 1000));
    const recentDiagnostics = instanceHistory.filter(d => 
      new Date(d.timestamp) > cutoffDate
    );

    return {
      instance_id: instanceId,
      period_days: days,
      total_diagnostics: recentDiagnostics.length,
      health_trend: this.calculateHealthTrend(recentDiagnostics),
      most_common_issues: this.getMostCommonIssues(recentDiagnostics),
      uptime_percentage: this.calculateUptimePercentage(recentDiagnostics),
      generated_at: new Date().toISOString()
    };
  }

  calculateHealthTrend(diagnostics) {
    if (diagnostics.length < 2) {
      return { trend: 'insufficient_data', message: 'Dados insuficientes para calcular tendência' };
    }

    // Calcular score de saúde para cada diagnóstico
    const healthScores = diagnostics.map(diagnostic => {
      const results = diagnostic.results || {};
      const totalChecks = Object.keys(results).length;
      const healthyChecks = Object.values(results).filter(result => 
        result.healthy === true || result.status === 'healthy'
      ).length;
      
      return totalChecks > 0 ? (healthyChecks / totalChecks) * 100 : 0;
    }).reverse(); // Ordenar do mais antigo para o mais recente

    // Calcular tendência
    const firstScore = healthScores[0];
    const lastScore = healthScores[healthScores.length - 1];
    const difference = lastScore - firstScore;

    let trend = 'stable';
    if (difference > 10) trend = 'improving';
    else if (difference < -10) trend = 'declining';

    return {
      trend,
      current_score: Math.round(lastScore),
      previous_score: Math.round(firstScore),
      change: Math.round(difference),
      scores: healthScores
    };
  }

  getMostCommonIssues(diagnostics) {
    const issueMap = new Map();

    diagnostics.forEach(diagnostic => {
      const results = diagnostic.results || {};
      
      Object.entries(results).forEach(([service, result]) => {
        if (result.issues && Array.isArray(result.issues)) {
          result.issues.forEach(issue => {
            const key = `${service}: ${issue}`;
            issueMap.set(key, (issueMap.get(key) || 0) + 1);
          });
        }
        
        if (!result.healthy && result.status) {
          const key = `${service}: ${result.status}`;
          issueMap.set(key, (issueMap.get(key) || 0) + 1);
        }
      });
    });

    return Array.from(issueMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([issue, count]) => ({ issue, count }));
  }

  calculateUptimePercentage(diagnostics) {
    if (diagnostics.length === 0) {
      return { uptime: 0, message: 'Nenhum diagnóstico disponível' };
    }

    const healthyCount = diagnostics.filter(diagnostic => {
      const results = diagnostic.results || {};
      const totalChecks = Object.keys(results).length;
      const healthyChecks = Object.values(results).filter(result => 
        result.healthy === true || result.status === 'healthy'
      ).length;
      
      return totalChecks > 0 && (healthyChecks / totalChecks) >= 0.7; // 70% dos serviços saudáveis = instância saudável
    }).length;

    const uptimePercentage = Math.round((healthyCount / diagnostics.length) * 100);

    return {
      uptime: uptimePercentage,
      healthy_diagnostics: healthyCount,
      total_diagnostics: diagnostics.length
    };
  }

  async getGlobalStats() {
    const history = await this.loadHistory();
    const instances = Object.keys(history);
    
    let totalDiagnostics = 0;
    let totalInstances = instances.length;
    let healthyInstances = 0;

    for (const instanceId of instances) {
      const instanceHistory = history[instanceId] || [];
      totalDiagnostics += instanceHistory.length;
      
      if (instanceHistory.length > 0) {
        const latestDiagnostic = instanceHistory[0];
        const results = latestDiagnostic.results || {};
        const totalChecks = Object.keys(results).length;
        const healthyChecks = Object.values(results).filter(result => 
          result.healthy === true || result.status === 'healthy'
        ).length;
        
        if (totalChecks > 0 && (healthyChecks / totalChecks) >= 0.7) {
          healthyInstances++;
        }
      }
    }

    return {
      total_instances: totalInstances,
      healthy_instances: healthyInstances,
      total_diagnostics: totalDiagnostics,
      average_diagnostics_per_instance: totalInstances > 0 ? Math.round(totalDiagnostics / totalInstances) : 0,
      generated_at: new Date().toISOString()
    };
  }

  async cleanOldDiagnostics(maxAge = 30) {
    const history = await this.loadHistory();
    const cutoffDate = new Date(Date.now() - (maxAge * 24 * 60 * 60 * 1000));
    let cleanedCount = 0;

    Object.keys(history).forEach(instanceId => {
      const originalLength = history[instanceId].length;
      history[instanceId] = history[instanceId].filter(diagnostic => 
        new Date(diagnostic.timestamp) > cutoffDate
      );
      cleanedCount += originalLength - history[instanceId].length;
    });

    await this.saveHistory(history);
    console.log(`🧹 Limpeza automática: ${cleanedCount} diagnósticos antigos removidos`);
    
    return { cleaned_count: cleanedCount };
  }
}

module.exports = DiagnosticHistory;