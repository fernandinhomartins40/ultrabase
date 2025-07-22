# Configuração do IP da VPS

## Problema Resolvido ✅

O sistema agora usa o **IP da VPS** em vez de `localhost` para as URLs dos projetos criados.

## Como Configurar

### Método 1: Variável de Ambiente (Recomendado)
```bash
export VPS_HOST="SEU_IP_AQUI"
# ou
export MANAGER_EXTERNAL_IP="SEU_IP_AQUI"

# Exemplo:
export VPS_HOST="82.25.69.57"
```

### Método 2: Docker/Docker Compose
```yaml
services:
  supabase-manager:
    environment:
      - VPS_HOST=82.25.69.57
      # ou
      - MANAGER_EXTERNAL_IP=82.25.69.57
```

### Método 3: Editar diretamente no código
Se não definir variável de ambiente, o sistema usa `82.25.69.57` como padrão.

## Verificar Configuração

1. **Acesse:** `http://SEU_IP:3080/api/config`
2. **Verifique** se `external_ip` está correto
3. **Teste** criando um projeto e verificando as URLs

## URLs Geradas Agora ✅

Antes (❌):
- Studio: `http://localhost:8100`
- API: `http://localhost:8100`  
- DB: `postgresql://postgres:password@localhost:5500/postgres`

Depois (✅):
- Studio: `http://82.25.69.57:8100`
- API: `http://82.25.69.57:8100`
- DB: `postgresql://postgres:password@82.25.69.57:5500/postgres`

## Testando

1. Reinicie o supabase-manager
2. Crie um novo projeto
3. Verifique se as URLs usam o IP da VPS
4. Teste acessando o Studio externamente

---

🎉 **Agora seus projetos Supabase serão acessíveis externamente!**