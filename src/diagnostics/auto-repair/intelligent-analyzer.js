/**
 * INTELLIGENT PROBLEM ANALYZER - Análise inteligente de problemas de instâncias
 * 
 * Analisa problemas detectados pelo diagnóstico e cria planos de correção
 * baseados em dependências e prioridades.
 */

class IntelligentProblemAnalyzer {
  constructor() {
    // Mapeamento de dependências entre componentes
    this.dependencyTree = {
      'infrastructure': [], // Base - não depende de nada
      'database': ['infrastructure'], // Depende de containers
      'network': ['infrastructure'], // Depende de containers
      'authentication': ['infrastructure', 'database'], // Depende de DB e containers
      'services': ['infrastructure', 'database', 'network'], // Depende de tudo
      'validation': ['infrastructure', 'database', 'network', 'authentication', 'services']
    };

    // Prioridades de correção
    this.priorities = {
      'infrastructure': 1, // Mais alta prioridade
      'database': 2,
      'network': 3,
      'authentication': 4,
      'services': 5,
      'validation': 6 // Mais baixa prioridade
    };

    // Estimativas de tempo por tipo de correção (em segundos)
    this.timeEstimates = {
      'container_restart': 45,
      'credential_regeneration': 60,
      'port_reallocation': 30,
      'service_restart': 25,
      'database_restart': 90,
      'full_instance_restart': 120,
      'volume_cleanup': 20
    };
  }

  /**
   * Analisa problemas e cria árvore de dependências
   */
  analyzeProblemChain(diagnostic) {
    try {
      console.log(`🔍 Analisando cadeia de problemas para diagnóstico...`);

      // 1. Extrair problemas do diagnóstico
      const problems = this.extractProblems(diagnostic);
      
      // 2. Classificar problemas por categoria
      const categorizedProblems = this.categorizeProblems(problems);
      
      // 3. Construir árvore de dependências
      const dependencies = this.buildDependencyTree(categorizedProblems);
      
      // 4. Calcular prioridades
      const prioritizedActions = this.calculatePriority(dependencies);
      
      // 5. Criar plano de correção
      const repairPlan = this.createRepairPlan(prioritizedActions);

      console.log(`✅ Plano de correção criado: ${repairPlan.actions.length} ações identificadas`);
      
      return repairPlan;

    } catch (error) {
      console.error(`❌ Erro na análise de problemas:`, error);
      return {
        success: false,
        error: error.message,
        actions: [],
        estimatedTime: 0
      };
    }
  }

  /**
   * Extrai problemas dos resultados do diagnóstico
   */
  extractProblems(diagnostic) {
    const problems = [];

    // Extrair de cada seção do diagnóstico
    if (diagnostic.results) {
      // Problemas de containers
      if (diagnostic.results.container_status && !diagnostic.results.container_status.healthy) {
        problems.push({
          category: 'infrastructure',
          type: 'containers_stopped',
          severity: 'critical',
          description: `${diagnostic.results.container_status.total_containers - diagnostic.results.container_status.running_containers} containers parados`,
          issues: diagnostic.results.container_status.issues || [],
          containers: diagnostic.results.container_status.containers || {}
        });
      }

      // Problemas de database
      if (diagnostic.results.database_connection && !diagnostic.results.database_connection.healthy) {
        problems.push({
          category: 'database',
          type: 'database_connection_failed',
          severity: 'critical',
          description: 'Conexão com database falhou',
          issues: diagnostic.results.database_connection.issues || [],
          port: diagnostic.results.database_connection.port
        });
      }

      // Problemas de conectividade
      if (diagnostic.results.network_connectivity && !diagnostic.results.network_connectivity.overall_healthy) {
        problems.push({
          category: 'network',
          type: 'network_connectivity_issues',
          severity: 'high',
          description: 'Problemas de conectividade de rede',
          issues: diagnostic.results.network_connectivity.issues || [],
          tests: diagnostic.results.network_connectivity.tests || {}
        });
      }

      // Problemas de autenticação
      if (diagnostic.results.auth_service && !diagnostic.results.auth_service.overall_healthy) {
        problems.push({
          category: 'authentication',
          type: 'auth_service_failed',
          severity: 'high',
          description: 'Serviços de autenticação inacessíveis',
          issues: diagnostic.results.auth_service.issues || [],
          tests: diagnostic.results.auth_service.tests || {}
        });
      }

      // Problemas de serviços HTTP
      if (diagnostic.results.service_health && !diagnostic.results.service_health.overall_healthy) {
        problems.push({
          category: 'services',
          type: 'http_services_failed',
          severity: 'medium',
          description: 'Serviços HTTP inacessíveis',
          issues: diagnostic.results.service_health.issues || [],
          services: diagnostic.results.service_health.services || {}
        });
      }
    }

    return problems;
  }

  /**
   * Categoriza problemas por tipo e severidade
   */
  categorizeProblems(problems) {
    const categorized = {
      infrastructure: [],
      database: [],
      network: [],
      authentication: [],
      services: []
    };

    problems.forEach(problem => {
      if (categorized[problem.category]) {
        categorized[problem.category].push(problem);
      }
    });

    return categorized;
  }

  /**
   * Constrói árvore de dependências para correções
   */
  buildDependencyTree(categorizedProblems) {
    const dependencies = {};

    // Para cada categoria, identificar dependências
    Object.keys(categorizedProblems).forEach(category => {
      if (categorizedProblems[category].length > 0) {
        dependencies[category] = {
          problems: categorizedProblems[category],
          dependsOn: this.dependencyTree[category] || [],
          priority: this.priorities[category] || 10
        };
      }
    });

    return dependencies;
  }

  /**
   * Calcula prioridade das ações baseada em dependências
   */
  calculatePriority(dependencies) {
    const actions = [];

    // Ordenar por prioridade (menor número = maior prioridade)
    const sortedCategories = Object.keys(dependencies).sort((a, b) => {
      return dependencies[a].priority - dependencies[b].priority;
    });

    sortedCategories.forEach(category => {
      const categoryData = dependencies[category];
      
      categoryData.problems.forEach(problem => {
        const action = this.problemToAction(problem);
        if (action) {
          actions.push({
            ...action,
            category: category,
            priority: categoryData.priority,
            dependsOn: categoryData.dependsOn
          });
        }
      });
    });

    return actions;
  }

  /**
   * Converte problema em ação de correção
   */
  problemToAction(problem) {
    switch (problem.type) {
      case 'containers_stopped':
        return {
          type: 'restart_containers',
          description: 'Reiniciar containers parados',
          estimatedTime: this.timeEstimates.container_restart,
          critical: true,
          method: 'fixStoppedContainers',
          parameters: {
            containers: problem.containers,
            issues: problem.issues
          }
        };

      case 'database_connection_failed':
        if (problem.issues.some(issue => issue.includes('password authentication failed'))) {
          return {
            type: 'regenerate_credentials',
            description: 'Regenerar credenciais PostgreSQL',
            estimatedTime: this.timeEstimates.credential_regeneration,
            critical: true,
            method: 'fixDatabaseCredentials',
            parameters: {
              port: problem.port,
              issues: problem.issues
            }
          };
        } else {
          return {
            type: 'restart_database',
            description: 'Reiniciar container PostgreSQL',
            estimatedTime: this.timeEstimates.database_restart,
            critical: true,
            method: 'restartDatabaseContainer',
            parameters: {
              port: problem.port,
              issues: problem.issues
            }
          };
        }

      case 'network_connectivity_issues':
        return {
          type: 'fix_network_connectivity',
          description: 'Corrigir conectividade de rede',
          estimatedTime: this.timeEstimates.port_reallocation,
          critical: false,
          method: 'fixNetworkConnectivity',
          parameters: {
            tests: problem.tests,
            issues: problem.issues
          }
        };

      case 'auth_service_failed':
        return {
          type: 'restart_auth_service',
          description: 'Reiniciar serviço de autenticação',
          estimatedTime: this.timeEstimates.service_restart,
          critical: false,
          method: 'restartAuthService',
          parameters: {
            tests: problem.tests,
            issues: problem.issues
          }
        };

      case 'http_services_failed':
        return {
          type: 'restart_http_services',
          description: 'Reiniciar serviços HTTP',
          estimatedTime: this.timeEstimates.service_restart,
          critical: false,
          method: 'restartHttpServices',
          parameters: {
            services: problem.services,
            issues: problem.issues
          }
        };

      default:
        console.warn(`⚠️ Tipo de problema desconhecido: ${problem.type}`);
        return null;
    }
  }

  /**
   * Cria plano de correção final
   */
  createRepairPlan(prioritizedActions) {
    const totalTime = prioritizedActions.reduce((sum, action) => sum + action.estimatedTime, 0);
    const criticalActions = prioritizedActions.filter(action => action.critical);

    return {
      success: true,
      actions: prioritizedActions,
      totalEstimatedTime: totalTime,
      criticalActionsCount: criticalActions.length,
      phases: this.groupActionsByPhase(prioritizedActions),
      summary: {
        totalActions: prioritizedActions.length,
        estimatedDuration: this.formatDuration(totalTime),
        criticalIssues: criticalActions.length,
        categories: [...new Set(prioritizedActions.map(a => a.category))]
      }
    };
  }

  /**
   * Agrupa ações por fase de execução
   */
  groupActionsByPhase(actions) {
    const phases = {
      infrastructure: [],
      database: [],
      network: [],
      authentication: [],
      services: [],
      validation: []
    };

    actions.forEach(action => {
      if (phases[action.category]) {
        phases[action.category].push(action);
      }
    });

    // Remover fases vazias
    Object.keys(phases).forEach(phase => {
      if (phases[phase].length === 0) {
        delete phases[phase];
      }
    });

    return phases;
  }

  /**
   * Formata duração em formato legível
   */
  formatDuration(seconds) {
    if (seconds < 60) {
      return `${seconds}s`;
    } else if (seconds < 3600) {
      const minutes = Math.floor(seconds / 60);
      const remainingSeconds = seconds % 60;
      return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
    } else {
      const hours = Math.floor(seconds / 3600);
      const minutes = Math.floor((seconds % 3600) / 60);
      return `${hours}h ${minutes}m`;
    }
  }

  /**
   * Analisa se uma instância precisa de correção completa
   */
  needsFullRepair(diagnostic) {
    if (!diagnostic.results) return false;

    const criticalSystemsDown = [
      !diagnostic.results.container_status?.healthy,
      !diagnostic.results.database_connection?.healthy,
      !diagnostic.results.service_health?.overall_healthy
    ];

    // Se 2 ou mais sistemas críticos estão com problema, precisa correção completa
    return criticalSystemsDown.filter(Boolean).length >= 2;
  }

  /**
   * Sugere tipo de correção baseado na análise
   */
  suggestRepairType(diagnostic) {
    const plan = this.analyzeProblemChain(diagnostic);
    
    if (!plan.success) {
      return 'manual'; // Falha na análise, requer correção manual
    }

    const criticalActions = plan.actions.filter(action => action.critical);
    
    if (criticalActions.length === 0) {
      return 'light'; // Apenas correções leves
    } else if (criticalActions.length <= 2) {
      return 'moderate'; // Correções moderadas
    } else {
      return 'aggressive'; // Correções agressivas necessárias
    }
  }
}

module.exports = IntelligentProblemAnalyzer;