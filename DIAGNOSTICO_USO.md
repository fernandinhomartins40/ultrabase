# Sistema de Diagnóstico Sob Demanda - Guia de Uso

## 🎯 Objetivo

O sistema de diagnóstico foi implementado para resolver o problema específico **"Failed to create user: API error happened while trying to communicate with the server"** e fornecer ferramentas completas de troubleshooting.

## 🚀 Como Usar

### 1. **Diagnóstico Completo de uma Instância**

```bash
# Executar diagnóstico completo
GET /api/instances/{INSTANCE_ID}/run-diagnostics

# Headers necessários
Authorization: Bearer {SEU_TOKEN}
```

**Exemplo de uso:**
```bash
curl -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." \
     http://localhost:3080/api/instances/abc12345/run-diagnostics
```

**O que verifica:**
- ✅ Status de todos os containers Docker
- ✅ Saúde dos serviços HTTP (Kong, GoTrue, PostgREST)
- ✅ Conexão direta com PostgreSQL
- ✅ **Teste específico do GoTrue** (foco no problema relatado)
- ✅ Uso de disco dos volumes
- ✅ Conectividade de rede
- ✅ Análise de logs recentes

### 2. **Ver Último Diagnóstico (Sem Executar Novo)**

```bash
GET /api/instances/{INSTANCE_ID}/last-diagnostic
```

Retorna o último diagnóstico em cache (válido por 5 minutos).

### 3. **Teste Específico do GoTrue**

```bash
# Foco no problema "Failed to create user"
GET /api/instances/{INSTANCE_ID}/test-auth-service
```

**O que testa especificamente:**
- ✅ Health endpoint do GoTrue (`/auth/v1/health`)
- ✅ Settings endpoint (`/auth/v1/settings`) 
- ✅ Validação de JWT secret
- ✅ Simulação de criação de usuário (sem criar de verdade)
- ✅ Análise de configuração de autenticação

### 4. **Análise de Logs Estruturados**

```bash
# Análise detalhada de logs
GET /api/instances/{INSTANCE_ID}/diagnostic-logs?services=auth,rest,db&level=error&range=1h
```

**Parâmetros:**
- `services`: auth,rest,db,kong,studio (padrão: auth,rest,db,kong)
- `level`: error,warn,info,debug (padrão: error)
- `range`: 15m,30m,1h,2h,6h,12h,24h (padrão: 1h)
- `limit`: número máximo de logs (padrão: 500)

### 5. **Diagnóstico de Todas as Instâncias (Admin)**

```bash
# Para usar em cron ou verificação geral
GET /api/instances/check-all-health
```

**Uso em cron (a cada 6 horas):**
```bash
# Adicionar ao crontab
0 */6 * * * curl -H "Authorization: Bearer TOKEN" \
  http://localhost:3080/api/instances/check-all-health >> /var/log/ultrabase-health.log 2>&1
```

## 📊 Exemplo de Resposta de Diagnóstico

```json
{
  "success": true,
  "message": "Diagnóstico executado com sucesso",
  "diagnostic": {
    "timestamp": "2025-01-28T10:30:00.000Z",
    "instance_id": "abc12345",
    "instance_name": "meu-projeto",
    "overall_healthy": false,
    "results": {
      "container_status": {
        "healthy": true,
        "running_containers": 7,
        "total_containers": 7
      },
      "auth_service": {
        "overall_healthy": false,
        "tests": {
          "health_endpoint": {
            "healthy": true,
            "status_code": 200
          },
          "user_creation_test": {
            "healthy": false,
            "status_code": 500,
            "error": "API error happened while trying to communicate with the server"
          }
        },
        "issues": [
          "User creation endpoint retornou 500"
        ]
      },
      "database_connection": {
        "healthy": true,
        "connection_time_ms": 45,
        "auth_users_count": 0
      }
    },
    "critical_issues": [
      {
        "severity": "critical",
        "category": "authentication",
        "message": "Serviço de autenticação (GoTrue) com problemas",
        "resolution": "Verificar logs do GoTrue e configuração JWT"
      }
    ],
    "recent_logs": {
      "period_minutes": 30,
      "error_count": 3,
      "critical_errors": [
        {
          "timestamp": "2025-01-28T10:25:00.000Z",
          "service": "auth",
          "level": "error",
          "message": "failed to create user: database connection failed"
        }
      ]
    }
  }
}
```

## 🔧 Resolução do Problema Específico

Para o erro **"Failed to create user"**, siga esta sequência:

### 1. **Execute o Teste Específico do GoTrue**
```bash
curl -H "Authorization: Bearer TOKEN" \
     http://localhost:3080/api/instances/INSTANCE_ID/test-auth-service
```

### 2. **Analise o Resultado**
- Se `health_endpoint.healthy = false`: GoTrue não está rodando
- Se `user_creation_test.healthy = false`: Problema na criação de usuários
- Se `jwt_validation.healthy = false`: Problema no JWT secret

### 3. **Verifique os Logs**
```bash
curl -H "Authorization: Bearer TOKEN" \
     "http://localhost:3080/api/instances/INSTANCE_ID/diagnostic-logs?services=auth&level=error&range=1h"
```

### 4. **Ações de Correção Baseadas no Diagnóstico**

**Se o problema for de conexão com banco:**
```bash
# Verificar container do PostgreSQL
docker ps | grep supabase-db-INSTANCE_ID

# Restart da instância (será implementado na Fase 2)
```

**Se o problema for de configuração JWT:**
- Verificar se `JWT_SECRET` está configurado corretamente
- Validar se `ANON_KEY` e `SERVICE_ROLE_KEY` são válidos

**Se o problema for do container GoTrue:**
```bash
# Ver logs específicos do GoTrue
docker logs supabase-auth-INSTANCE_ID
```

## ⚡ Rate Limiting

- **1 diagnóstico completo** por instância a cada **2 minutos**
- **Cache de 5 minutos** para evitar execuções desnecessárias
- Sem limite para consulta de último diagnóstico

## 🔒 Permissões

- **Usuários normais**: Podem executar diagnósticos apenas das próprias instâncias
- **Administradores**: Podem executar diagnósticos de todas as instâncias + diagnóstico geral

## 📝 Logs de Auditoria

Todas as execuções de diagnóstico são logadas no console:
```
🔍 Usuário admin executando diagnóstico para instância abc12345
✅ Diagnóstico concluído para abc12345: PROBLEMAS DETECTADOS
```

## 🎛️ Próximas Fases

**Fase 2**: Ações de reparo automático (restart seguro, correção de configuração)
**Fase 3**: Interface visual no dashboard
**Fase 4**: Relatórios históricos e tendências

---

## 🆘 Suporte

Se o diagnóstico não identificar o problema:

1. Execute o diagnóstico completo
2. Capture os logs estruturados  
3. Verifique os `critical_issues` na resposta
4. Analise os `error_patterns` identificados
5. Use as `recommendations` fornecidas

O sistema foi projetado especificamente para resolver problemas como o **"Failed to create user"** e similares no GoTrue.