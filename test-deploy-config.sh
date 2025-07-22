#!/bin/bash

# 🧪 Script de Teste da Configuração de Deploy
# Valida se todas as configurações estão corretas para a nova estrutura

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

print_header() {
    echo ""
    echo -e "${BLUE}╔══════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${BLUE}║                                                              ║${NC}"
    echo -e "${BLUE}║           🧪 TESTE DE CONFIGURAÇÃO DE DEPLOY               ║${NC}"
    echo -e "${BLUE}║                                                              ║${NC}"
    echo -e "${BLUE}╚══════════════════════════════════════════════════════════════╝${NC}"
    echo ""
}

test_step() {
    echo -e "${BLUE}🔷 $1${NC}"
}

test_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

test_error() {
    echo -e "${RED}❌ $1${NC}"
}

test_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

# Teste 1: Estrutura de diretórios
test_structure() {
    test_step "Testando estrutura de diretórios..."
    
    if [ -d "src" ]; then
        test_success "Diretório src/ encontrado"
    else
        test_error "Diretório src/ não encontrado"
        return 1
    fi
    
    if [ -d "supabase-core" ]; then
        test_success "Diretório supabase-core/ encontrado"
    else
        test_error "Diretório supabase-core/ não encontrado"
        return 1
    fi
    
    if [ -f "src/server.js" ]; then
        test_success "Arquivo src/server.js encontrado"
    else
        test_error "Arquivo src/server.js não encontrado"
        return 1
    fi
    
    if [ -f "supabase-core/generate-adapted.bash" ]; then
        test_success "Script generate-adapted.bash encontrado"
    else
        test_error "Script generate-adapted.bash não encontrado"
        return 1
    fi
}

# Teste 2: Configuração do server.js
test_server_config() {
    test_step "Testando configuração do server.js..."
    
    if grep -q "supabase-core" src/server.js; then
        test_success "Path supabase-core configurado corretamente"
    else
        test_error "Path supabase-core não encontrado no server.js"
        return 1
    fi
    
    # Verificar sintaxe JavaScript
    if node -c src/server.js; then
        test_success "Sintaxe do server.js válida"
    else
        test_error "Erro de sintaxe no server.js"
        return 1
    fi
}

# Teste 3: Scripts de deploy
test_deploy_scripts() {
    test_step "Testando scripts de deploy..."
    
    # GitHub Actions
    if [ -f ".github/workflows/deploy.yml" ]; then
        if grep -q "src/" .github/workflows/deploy.yml; then
            test_success "GitHub Actions configurado para nova estrutura"
        else
            test_error "GitHub Actions ainda usa estrutura antiga"
            return 1
        fi
    else
        test_warning "Arquivo de GitHub Actions não encontrado"
    fi
    
    # Install script
    if [ -f "src/docker/install.sh" ]; then
        if grep -q "supabase-core" src/docker/install.sh; then
            test_success "Install script configurado corretamente"
        else
            test_error "Install script usa paths antigos"
            return 1
        fi
    else
        test_warning "Script install.sh não encontrado"
    fi
}

# Teste 4: Docker configs
test_docker_configs() {
    test_step "Testando configurações Docker..."
    
    if [ -f "src/docker/docker-compose.production.yml" ]; then
        if grep -q "supabase-core" src/docker/docker-compose.production.yml; then
            test_success "Docker Compose production configurado corretamente"
        else
            test_error "Docker Compose production usa paths antigos"
            return 1
        fi
    else
        test_warning "docker-compose.production.yml não encontrado"
    fi
    
    if [ -f "src/docker/Dockerfile.production" ]; then
        test_success "Dockerfile.production encontrado"
    else
        test_warning "Dockerfile.production não encontrado"
    fi
}

# Teste 5: Dependências
test_dependencies() {
    test_step "Testando dependências..."
    
    if [ -f "src/package.json" ]; then
        test_success "package.json encontrado"
        
        cd src
        if npm list --depth=0 > /dev/null 2>&1; then
            test_success "Todas as dependências estão instaladas"
        else
            test_warning "Algumas dependências podem estar faltando"
        fi
        cd ..
    else
        test_error "package.json não encontrado"
        return 1
    fi
}

# Teste 6: Documentação
test_documentation() {
    test_step "Testando documentação..."
    
    if [ -f "DEPLOY_GUIDE.md" ]; then
        if grep -q "supabase-core" DEPLOY_GUIDE.md && ! grep -q "docker/" DEPLOY_GUIDE.md; then
            test_success "DEPLOY_GUIDE.md atualizado para nova estrutura"
        else
            test_error "DEPLOY_GUIDE.md não atualizado"
            return 1
        fi
    else
        test_warning "DEPLOY_GUIDE.md não encontrado"
    fi
    
    if [ -f "README.md" ]; then
        test_success "README.md encontrado"
    else
        test_warning "README.md não encontrado"
    fi
}

# Função principal
main() {
    print_header
    
    local failed_tests=0
    
    test_structure || ((failed_tests++))
    echo ""
    
    test_server_config || ((failed_tests++))
    echo ""
    
    test_deploy_scripts || ((failed_tests++))
    echo ""
    
    test_docker_configs || ((failed_tests++))
    echo ""
    
    test_dependencies || ((failed_tests++))
    echo ""
    
    test_documentation || ((failed_tests++))
    echo ""
    
    # Resultado final
    if [ $failed_tests -eq 0 ]; then
        echo -e "${GREEN}╔══════════════════════════════════════════════════════════════╗${NC}"
        echo -e "${GREEN}║                                                              ║${NC}"
        echo -e "${GREEN}║         🎉 TODOS OS TESTES PASSARAM COM SUCESSO!            ║${NC}"
        echo -e "${GREEN}║                                                              ║${NC}"
        echo -e "${GREEN}║         Deploy está pronto para ser executado!              ║${NC}"
        echo -e "${GREEN}║                                                              ║${NC}"
        echo -e "${GREEN}╚══════════════════════════════════════════════════════════════╝${NC}"
        echo ""
        echo -e "${GREEN}✅ Configuração de deploy validada com sucesso!${NC}"
        echo -e "${BLUE}🚀 Próximo passo: git commit & git push para deploy automático${NC}"
        return 0
    else
        echo -e "${RED}╔══════════════════════════════════════════════════════════════╗${NC}"
        echo -e "${RED}║                                                              ║${NC}"
        echo -e "${RED}║         ❌ ALGUNS TESTES FALHARAM                           ║${NC}"
        echo -e "${RED}║                                                              ║${NC}"
        echo -e "${RED}║         Corrija os problemas antes do deploy                ║${NC}"
        echo -e "${RED}║                                                              ║${NC}"
        echo -e "${RED}╚══════════════════════════════════════════════════════════════╝${NC}"
        echo ""
        echo -e "${RED}❌ $failed_tests teste(s) falharam${NC}"
        echo -e "${YELLOW}⚠️  Corrija os problemas listados acima antes do deploy${NC}"
        return 1
    fi
}

# Executar testes
main "$@"