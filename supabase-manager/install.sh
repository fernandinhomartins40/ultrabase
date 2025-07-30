#!/bin/bash

# 🚀 Supabase Instance Manager - Instalador Automático
# 
# Este script configura automaticamente o Gerenciador de Instâncias Supabase
# Replica a experiência do Supabase Cloud em sua própria VPS

set -e

# Cores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Função para printar com cores
print_color() {
    printf "${1}${2}${NC}\n"
}

print_header() {
    echo ""
    print_color $CYAN "╔══════════════════════════════════════════════════════════════╗"
    print_color $CYAN "║                                                              ║"
    print_color $CYAN "║         🚀 SUPABASE INSTANCE MANAGER INSTALLER             ║"
    print_color $CYAN "║                                                              ║"
    print_color $CYAN "║         Seu Supabase Cloud Privado                          ║"
    print_color $CYAN "╚══════════════════════════════════════════════════════════════╝"
    echo ""
}

print_step() {
    print_color $BLUE "🔷 $1"
}

print_success() {
    print_color $GREEN "✅ $1"
}

print_warning() {
    print_color $YELLOW "⚠️  $1"
}

print_error() {
    print_color $RED "❌ $1"
}

# Verificar se está sendo executado como root
check_root() {
    if [[ $EUID -eq 0 ]]; then
        print_warning "Este script não deve ser executado como root"
        print_color $YELLOW "Execute como usuário normal: ./install.sh"
        exit 1
    fi
}

# Verificar se Docker está instalado e funcionando
check_docker() {
    print_step "Verificando Docker..."
    
    if ! command -v docker &> /dev/null; then
        print_error "Docker não está instalado"
        print_color $YELLOW "Instale o Docker primeiro: https://docs.docker.com/get-docker/"
        exit 1
    fi
    
    if ! docker version &> /dev/null; then
        print_error "Docker não está funcionando"
        print_color $YELLOW "Verifique se o Docker está rodando: sudo systemctl start docker"
        exit 1
    fi
    
    if ! docker compose version &> /dev/null; then
        print_error "Docker Compose não está instalado"
        print_color $YELLOW "Instale o Docker Compose: https://docs.docker.com/compose/install/"
        exit 1
    fi
    
    print_success "Docker e Docker Compose OK"
}

# Verificar se Node.js está instalado
check_nodejs() {
    print_step "Verificando Node.js..."
    
    if ! command -v node &> /dev/null; then
        print_error "Node.js não está instalado"
        print_color $YELLOW "Instale Node.js 18+: https://nodejs.org/"
        exit 1
    fi
    
    NODE_VERSION=$(node --version | cut -d'v' -f2 | cut -d'.' -f1)
    if [ "$NODE_VERSION" -lt 18 ]; then
        print_error "Node.js versão 18+ é necessária (atual: $(node --version))"
        print_color $YELLOW "Atualize para Node.js 18+: https://nodejs.org/"
        exit 1
    fi
    
    if ! command -v npm &> /dev/null; then
        print_error "NPM não está instalado"
        exit 1
    fi
    
    print_success "Node.js $(node --version) e NPM OK"
}

# Verificar estrutura do Supabase
check_supabase_structure() {
    print_step "Verificando estrutura do Supabase..."
    
    DOCKER_DIR="../docker"
    
    if [ ! -d "$DOCKER_DIR" ]; then
        print_error "Diretório $DOCKER_DIR não encontrado"
        print_color $YELLOW "Execute este script dentro do diretório supabase-manager/"
        print_color $YELLOW "A estrutura deve ser:"
        print_color $YELLOW "  ultrabase/"
        print_color $YELLOW "  ├── docker/"
        print_color $YELLOW "  └── supabase-manager/"
        exit 1
    fi
    
    if [ ! -f "$DOCKER_DIR/docker-compose.yml" ]; then
        print_error "Arquivo docker-compose.yml não encontrado em $DOCKER_DIR"
        exit 1
    fi
    
    if [ ! -f "$DOCKER_DIR/.env.template" ]; then
        print_error "Arquivo .env.template não encontrado em $DOCKER_DIR"
        exit 1
    fi
    
    if [ ! -d "$DOCKER_DIR/volumes" ]; then
        print_error "Diretório volumes não encontrado em $DOCKER_DIR"
        exit 1
    fi
    
    print_success "Estrutura do Supabase OK"
}

# Verificar porta disponível
check_port() {
    print_step "Verificando porta 3080..."
    
    if lsof -Pi :3080 -sTCP:LISTEN -t >/dev/null; then
        print_warning "Porta 3080 está em uso"
        print_color $YELLOW "Parando processo na porta 3080..."
        
        PID=$(lsof -t -i:3080)
        if [ ! -z "$PID" ]; then
            kill -9 $PID 2>/dev/null || true
            sleep 2
        fi
        
        if lsof -Pi :3080 -sTCP:LISTEN -t >/dev/null; then
            print_error "Não foi possível liberar a porta 3080"
            print_color $YELLOW "Libere a porta manualmente e tente novamente"
            exit 1
        fi
    fi
    
    print_success "Porta 3080 disponível"
}

# Instalar dependências NPM
install_dependencies() {
    print_step "Instalando dependências NPM..."
    
    if [ ! -f "package.json" ]; then
        print_error "Arquivo package.json não encontrado"
        print_color $YELLOW "Execute este script dentro do diretório supabase-manager/"
        exit 1
    fi
    
    npm install --silent
    
    print_success "Dependências instaladas"
}

# Criar diretórios necessários
create_directories() {
    print_step "Criando diretórios necessários..."
    
    mkdir -p logs
    touch instances.json
    
    # Criar arquivo de configuração padrão se não existir
    if [ ! -f "instances.json" ] || [ ! -s "instances.json" ]; then
        echo "{}" > instances.json
    fi
    
    print_success "Diretórios criados"
}

# Verificar permissões Docker
check_docker_permissions() {
    print_step "Verificando permissões Docker..."
    
    if ! docker ps &> /dev/null; then
        print_warning "Usuário não tem permissões para usar Docker"
        print_color $YELLOW "Adicionando usuário ao grupo docker..."
        
        # Tentar adicionar ao grupo docker
        if command -v usermod &> /dev/null; then
            sudo usermod -aG docker $USER
            print_color $YELLOW "Usuário adicionado ao grupo docker"
            print_color $YELLOW "REINICIE o terminal ou execute: newgrp docker"
            print_color $YELLOW "Depois execute o instalador novamente"
            exit 0
        else
            print_error "Não foi possível adicionar usuário ao grupo docker"
            print_color $YELLOW "Execute manualmente: sudo usermod -aG docker $USER"
            print_color $YELLOW "Depois reinicie o terminal"
            exit 1
        fi
    fi
    
    print_success "Permissões Docker OK"
}

# Testar criação de instância
test_system() {
    print_step "Testando sistema..."
    
    # Iniciar servidor em background
    print_color $CYAN "Iniciando servidor de teste..."
    node server.js &
    SERVER_PID=$!
    
    # Aguardar servidor inicializar
    sleep 5
    
    # Testar endpoint de health
    if curl -s http://localhost:3080/api/health > /dev/null; then
        print_success "Servidor funcionando corretamente"
    else
        print_error "Servidor não está respondendo"
        kill $SERVER_PID 2>/dev/null || true
        exit 1
    fi
    
    # Parar servidor de teste
    kill $SERVER_PID 2>/dev/null || true
    sleep 2
    
    print_success "Teste concluído"
}

# Criar script de inicialização
create_startup_script() {
    print_step "Criando script de inicialização..."
    
    cat > start.sh << 'EOF'
#!/bin/bash

# 🚀 Supabase Instance Manager - Start Script

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "🚀 Iniciando Supabase Instance Manager..."

# Verificar se já está rodando
if lsof -Pi :3080 -sTCP:LISTEN -t >/dev/null; then
    echo "⚠️  Gerenciador já está rodando na porta 3080"
    echo "   Acesse: http://localhost:3080"
    exit 0
fi

# Verificar Docker
if ! docker version &> /dev/null; then
    echo "❌ Docker não está funcionando"
    echo "   Inicie o Docker: sudo systemctl start docker"
    exit 1
fi

# Iniciar servidor
echo "🔷 Iniciando servidor..."
node server.js

EOF

    chmod +x start.sh
    
    print_success "Script de inicialização criado (start.sh)"
}

# Criar script de parada
create_stop_script() {
    print_step "Criando script de parada..."
    
    cat > stop.sh << 'EOF'
#!/bin/bash

# 🛑 Supabase Instance Manager - Stop Script

echo "🛑 Parando Supabase Instance Manager..."

# Parar servidor na porta 3080
PID=$(lsof -t -i:3080 2>/dev/null)
if [ ! -z "$PID" ]; then
    kill -9 $PID
    echo "✅ Servidor parado"
else
    echo "ℹ️  Servidor não estava rodando"
fi

# Opcional: Parar todas as instâncias Supabase
read -p "Parar todas as instâncias Supabase? (y/N): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "🔷 Parando todas as instâncias Supabase..."
    
    # Encontrar todos os docker-compose de instâncias
    for compose_file in ../docker/docker-compose-*.yml; do
        if [ -f "$compose_file" ]; then
            echo "  Parando: $(basename "$compose_file")"
            cd ../docker
            docker compose -f "$(basename "$compose_file")" down 2>/dev/null || true
            cd - > /dev/null
        fi
    done
    
    echo "✅ Todas as instâncias foram paradas"
fi

echo "🏁 Processo concluído"

EOF

    chmod +x stop.sh
    
    print_success "Script de parada criado (stop.sh)"
}

# Função principal
main() {
    print_header
    
    print_color $PURPLE "Configurando seu Supabase Cloud privado..."
    echo ""
    
    # Verificações
    check_root
    check_docker
    check_nodejs
    check_supabase_structure
    check_docker_permissions
    check_port
    
    # Instalação
    install_dependencies
    create_directories
    create_startup_script
    create_stop_script
    
    # Teste
    test_system
    
    # Sucesso
    echo ""
    print_color $GREEN "╔══════════════════════════════════════════════════════════════╗"
    print_color $GREEN "║                                                              ║"
    print_color $GREEN "║         🎉 INSTALAÇÃO CONCLUÍDA COM SUCESSO!               ║"
    print_color $GREEN "║                                                              ║"
    print_color $GREEN "╚══════════════════════════════════════════════════════════════╝"
    echo ""
    
    print_success "Supabase Instance Manager instalado com sucesso!"
    echo ""
    
    print_color $CYAN "📋 PRÓXIMOS PASSOS:"
    echo ""
    print_color $YELLOW "1. Iniciar o gerenciador:"
    print_color $WHITE "   ./start.sh"
    echo ""
    print_color $YELLOW "2. Acessar dashboard:"
    print_color $WHITE "   http://localhost:3080"
    echo ""
    print_color $YELLOW "3. Criar seu primeiro projeto:"
    print_color $WHITE "   Click em 'Criar Novo Projeto'"
    echo ""
    print_color $YELLOW "4. Para parar o sistema:"
    print_color $WHITE "   ./stop.sh"
    echo ""
    
    print_color $CYAN "🎯 FUNCIONALIDADES DISPONÍVEIS:"
    echo "   ✅ Dashboard web igual ao supabase.com"
    echo "   ✅ Criação de projetos isolados"
    echo "   ✅ URLs únicas para cada projeto"
    echo "   ✅ Gerenciamento completo via web"
    echo "   ✅ Monitoramento em tempo real"
    echo "   ✅ Logs individuais por projeto"
    echo ""
    
    print_color $GREEN "Seu Supabase Cloud privado está pronto! 🚀"
    echo ""
    
    # Perguntar se deve iniciar automaticamente
    read -p "Deseja iniciar o gerenciador agora? (Y/n): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Nn]$ ]]; then
        print_color $CYAN "Execute ./start.sh quando estiver pronto!"
    else
        print_color $CYAN "Iniciando gerenciador..."
        ./start.sh
    fi
}

# Executar função principal
main "$@"