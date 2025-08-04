#!/bin/bash

# Continuum Relayer Startup Script
# This script starts the relayer service with proper configuration

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Default values
RELAYER_MODE=${RELAYER_MODE:-"standalone"}
CONFIG_FILE=${CONFIG_FILE:-".env"}
LOG_DIR=${LOG_DIR:-"./logs"}
DATA_DIR=${DATA_DIR:-"./data"}

# Print banner
echo -e "${GREEN}"
echo "╔═══════════════════════════════════════════╗"
echo "║       Continuum Relayer Service           ║"
echo "║         MEV Protection for DeFi           ║"
echo "╚═══════════════════════════════════════════╝"
echo -e "${NC}"

# Function to check prerequisites
check_prerequisites() {
    echo -e "${YELLOW}Checking prerequisites...${NC}"
    
    # Check Node.js
    if ! command -v node &> /dev/null; then
        echo -e "${RED}Error: Node.js is not installed${NC}"
        echo "Please install Node.js 18 or higher"
        exit 1
    fi
    
    # Check Node version
    NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
    if [ "$NODE_VERSION" -lt 18 ]; then
        echo -e "${RED}Error: Node.js version must be 18 or higher${NC}"
        echo "Current version: $(node -v)"
        exit 1
    fi
    
    # Check if config file exists
    if [ ! -f "$CONFIG_FILE" ]; then
        echo -e "${YELLOW}Warning: Configuration file not found${NC}"
        echo "Creating default configuration..."
        create_default_config
    fi
    
    # Create directories
    mkdir -p "$LOG_DIR" "$DATA_DIR"
    
    echo -e "${GREEN}Prerequisites check passed${NC}"
}

# Function to create default configuration
create_default_config() {
    cat > "$CONFIG_FILE" << EOF
# Continuum Relayer Configuration

# RPC Configuration
RPC_URL=http://localhost:8899
WS_URL=ws://localhost:8900

# Relayer Configuration
RELAYER_KEYPAIR_PATH=./relayer-keypair.json
RELAYER_FEE_BPS=10

# Program IDs
CONTINUUM_PROGRAM_ID=EaeWUSam5Li1fzCcCs33oE4jCLQT4F6RJXgrPYZaoKqq
CP_SWAP_PROGRAM_ID=GkenxCtvEabZrwFf15D3E6LjoZTywH2afNwiqDwthyDp

# Server Configuration
PORT=8086
ALLOWED_ORIGINS=*

# Performance Settings
POLL_INTERVAL_MS=1000
MAX_CONCURRENT_EXECUTIONS=5
RETRY_ATTEMPTS=3
RETRY_DELAY_MS=1000

# Order Limits
MIN_ORDER_SIZE=1000000
MAX_ORDER_SIZE=1000000000000

# Logging
LOG_LEVEL=info

# Features
ENABLE_MOCK_MODE=false
ENABLE_AIRDROP=true
AIRDROP_AMOUNT_SOL=1
AIRDROP_RATE_LIMIT_MS=60000

# Transaction Settings
PRIORITY_FEE_LEVEL=medium
COMPUTE_UNIT_LIMIT=400000
CONFIRMATION_TIMEOUT_MS=60000

# Redis (optional)
# REDIS_URL=redis://localhost:6379

# Monitoring (optional)
# ENABLE_METRICS=true
# METRICS_PORT=9091
EOF
    echo -e "${GREEN}Created default configuration file: $CONFIG_FILE${NC}"
}

# Function to generate keypair if needed
check_keypair() {
    KEYPAIR_PATH=$(grep RELAYER_KEYPAIR_PATH "$CONFIG_FILE" | cut -d'=' -f2)
    
    if [ ! -f "$KEYPAIR_PATH" ]; then
        echo -e "${YELLOW}Relayer keypair not found${NC}"
        echo "Generating new keypair..."
        
        # Use Node.js to generate keypair
        node -e "
        const { Keypair } = require('@solana/web3.js');
        const fs = require('fs');
        const keypair = Keypair.generate();
        fs.writeFileSync('$KEYPAIR_PATH', JSON.stringify(Array.from(keypair.secretKey)));
        console.log('Relayer address:', keypair.publicKey.toBase58());
        console.log('Keypair saved to: $KEYPAIR_PATH');
        "
        
        echo -e "${YELLOW}IMPORTANT: Fund this address with SOL for transaction fees${NC}"
    else
        # Display relayer address
        RELAYER_ADDRESS=$(node -e "
        const { Keypair } = require('@solana/web3.js');
        const fs = require('fs');
        const data = JSON.parse(fs.readFileSync('$KEYPAIR_PATH'));
        const keypair = Keypair.fromSecretKey(new Uint8Array(data));
        console.log(keypair.publicKey.toBase58());
        ")
        echo -e "${GREEN}Relayer address: $RELAYER_ADDRESS${NC}"
    fi
}

# Function to check balance
check_balance() {
    echo -e "${YELLOW}Checking relayer balance...${NC}"
    
    RPC_URL=$(grep RPC_URL "$CONFIG_FILE" | cut -d'=' -f2)
    KEYPAIR_PATH=$(grep RELAYER_KEYPAIR_PATH "$CONFIG_FILE" | cut -d'=' -f2)
    
    BALANCE=$(node -e "
    const { Connection, Keypair, LAMPORTS_PER_SOL } = require('@solana/web3.js');
    const fs = require('fs');
    
    async function checkBalance() {
        const connection = new Connection('$RPC_URL');
        const data = JSON.parse(fs.readFileSync('$KEYPAIR_PATH'));
        const keypair = Keypair.fromSecretKey(new Uint8Array(data));
        const balance = await connection.getBalance(keypair.publicKey);
        console.log((balance / LAMPORTS_PER_SOL).toFixed(4));
    }
    
    checkBalance().catch(console.error);
    " 2>/dev/null || echo "0")
    
    if (( $(echo "$BALANCE < 0.1" | bc -l) )); then
        echo -e "${RED}Warning: Low balance ($BALANCE SOL)${NC}"
        echo "Please fund the relayer wallet with at least 0.1 SOL"
    else
        echo -e "${GREEN}Balance: $BALANCE SOL${NC}"
    fi
}

# Function to install dependencies
install_dependencies() {
    if [ ! -d "node_modules" ]; then
        echo -e "${YELLOW}Installing dependencies...${NC}"
        npm install
    fi
}

# Function to build the project
build_project() {
    if [ ! -d "dist" ] || [ "$1" == "force" ]; then
        echo -e "${YELLOW}Building project...${NC}"
        npm run build
    fi
}

# Function to start in standalone mode
start_standalone() {
    echo -e "${GREEN}Starting relayer in standalone mode...${NC}"
    
    # Export environment variables
    export $(grep -v '^#' "$CONFIG_FILE" | xargs)
    
    # Start the relayer
    if [ "$NODE_ENV" == "production" ]; then
        npm start
    else
        npm run dev
    fi
}

# Function to start with Docker
start_docker() {
    echo -e "${GREEN}Starting relayer with Docker...${NC}"
    
    if ! command -v docker &> /dev/null; then
        echo -e "${RED}Error: Docker is not installed${NC}"
        exit 1
    fi
    
    # Check if SSL certificates exist
    SSL_CERT_PATH="/home/ec2-user/fs4/ssl1.cert"
    SSL_KEY_PATH="/home/ec2-user/fs4/ssl2.key"
    
    if [ ! -f "$SSL_CERT_PATH" ] || [ ! -f "$SSL_KEY_PATH" ]; then
        echo -e "${RED}Error: SSL certificates not found${NC}"
        echo "Expected locations:"
        echo "  - Certificate: $SSL_CERT_PATH"
        echo "  - Key: $SSL_KEY_PATH"
        exit 1
    fi
    
    # Create ssl directory and copy certificates
    mkdir -p ssl
    cp "$SSL_CERT_PATH" ssl/ssl1.cert
    cp "$SSL_KEY_PATH" ssl/ssl2.key
    
    # Build and start containers
    echo -e "${YELLOW}Building and starting Docker containers...${NC}"
    docker-compose up --build -d
    
    # Wait a moment for containers to start
    echo -e "${YELLOW}Waiting for services to start...${NC}"
    sleep 3
    
    # Check if containers are running
    echo -e "${YELLOW}Checking container status...${NC}"
    if docker ps | grep -q "continuum-nginx"; then
        echo -e "${GREEN}✓ Nginx container is running${NC}"
    else
        echo -e "${RED}✗ Nginx container failed to start${NC}"
    fi
    
    if docker ps | grep -q "continuum-relayer"; then
        echo -e "${GREEN}✓ Relayer container is running${NC}"
    else
        echo -e "${RED}✗ Relayer container failed to start${NC}"
    fi
    
    # Show recent logs
    echo -e "${YELLOW}Recent startup logs:${NC}"
    docker-compose logs --tail=10
    
    echo -e "${GREEN}Relayer started in Docker with Nginx reverse proxy${NC}"
    echo "Services:"
    echo "  - HTTP: http://localhost:80"
    echo "  - HTTPS: https://localhost:443 (redirects to HTTP)"
    echo "  - Direct relayer: http://localhost:8080 (internal only)"
    echo ""
    echo "Commands:"
    echo "  - View all logs: docker-compose logs -f"
    echo "  - View relayer logs: docker-compose logs -f relayer"
    echo "  - View nginx logs: docker-compose logs -f nginx"
    echo "  - Check status: ./start-relayer.sh status"
}

# Function to start with PM2
start_pm2() {
    echo -e "${GREEN}Starting relayer with PM2...${NC}"
    
    if ! command -v pm2 &> /dev/null; then
        echo -e "${YELLOW}PM2 not found. Installing...${NC}"
        npm install -g pm2
    fi
    
    # Create PM2 ecosystem file
    cat > ecosystem.config.js << EOF
module.exports = {
  apps: [{
    name: 'continuum-relayer',
    script: './dist/server.js',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production'
    },
    error_file: './logs/pm2-error.log',
    out_file: './logs/pm2-out.log',
    log_file: './logs/pm2-combined.log',
    time: true
  }]
};
EOF
    
    # Start with PM2
    pm2 start ecosystem.config.js
    pm2 save
    
    echo -e "${GREEN}Relayer started with PM2${NC}"
    echo "View logs: pm2 logs continuum-relayer"
    echo "Monitor: pm2 monit"
}

# Function to show status
show_status() {
    echo -e "${YELLOW}Relayer Status:${NC}"
    
    # Check if running with PM2
    if command -v pm2 &> /dev/null && pm2 list | grep -q "continuum-relayer"; then
        pm2 status continuum-relayer
    fi
    
    # Check if running with Docker
    if command -v docker &> /dev/null && docker ps | grep -q "continuum-relayer"; then
        echo -e "${GREEN}Docker containers:${NC}"
        docker ps | grep -E "continuum-(relayer|nginx)" | awk '{print "  - " $NF ": " $7}'
    fi
    
    # Check Nginx reverse proxy
    if curl -s http://localhost:80/health > /dev/null 2>&1; then
        echo -e "${GREEN}Nginx reverse proxy: Running${NC}"
        echo -e "${GREEN}  - HTTP: http://localhost:80${NC}"
        echo -e "${GREEN}  - HTTPS: https://localhost:443 (redirects to HTTP)${NC}"
    fi
    
    # Check direct relayer endpoint
    PORT=$(grep PORT "$CONFIG_FILE" | cut -d'=' -f2 || echo "8086")
    if curl -s http://localhost:$PORT/health > /dev/null 2>&1; then
        echo -e "${GREEN}Direct relayer API: Running on http://localhost:$PORT${NC}"
        echo -e "${GREEN}WebSocket: Available on ws://localhost:$PORT/ws${NC}"
    else
        echo -e "${RED}Relayer service not responding on port $PORT${NC}"
    fi
}

# Main execution
main() {
    case "$1" in
        "start")
            check_prerequisites
            install_dependencies
            check_keypair
            check_balance
            build_project
            
            case "$RELAYER_MODE" in
                "docker")
                    start_docker
                    ;;
                "pm2")
                    start_pm2
                    ;;
                *)
                    start_standalone
                    ;;
            esac
            ;;
            
        "stop")
            echo -e "${YELLOW}Stopping relayer...${NC}"
            if [ "$RELAYER_MODE" == "pm2" ]; then
                pm2 stop continuum-relayer
            elif [ "$RELAYER_MODE" == "docker" ]; then
                docker-compose down
            else
                pkill -f "node.*server.js" || true
            fi
            echo -e "${GREEN}Relayer stopped${NC}"
            ;;
            
        "restart")
            $0 stop
            sleep 2
            $0 start
            ;;
            
        "status")
            show_status
            ;;
            
        "logs")
            if [ "$RELAYER_MODE" == "pm2" ]; then
                pm2 logs continuum-relayer
            elif [ "$RELAYER_MODE" == "docker" ]; then
                echo "Following logs for all services (use Ctrl+C to exit)..."
                docker-compose logs -f
            else
                tail -f logs/relayer.log
            fi
            ;;
            
        "build")
            install_dependencies
            build_project force
            ;;
            
        *)
            echo "Usage: $0 {start|stop|restart|status|logs|build}"
            echo ""
            echo "Environment variables:"
            echo "  RELAYER_MODE    - standalone (default), docker, or pm2"
            echo "  CONFIG_FILE     - Path to configuration file (default: .env)"
            echo "  NODE_ENV        - development or production"
            echo ""
            echo "Examples:"
            echo "  $0 start                           # Start in standalone mode"
            echo "  RELAYER_MODE=docker $0 start      # Start with Docker"
            echo "  RELAYER_MODE=pm2 $0 start         # Start with PM2"
            exit 1
            ;;
    esac
}

# Run main function
main "$@"