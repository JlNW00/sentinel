#!/bin/bash
set -euo pipefail

# ============================================================
# SENTINEL SETUP SCRIPT — No Docker Required
# ============================================================
# One-command setup for the Sentinel autonomous forensics agent.
# Installs all dependencies natively on Linux (Ubuntu/Debian) or macOS.
#
# Usage: chmod +x setup.sh && ./setup.sh
# ============================================================

SENTINEL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

log_info()  { echo -e "${CYAN}[INFO]${NC} $1"; }
log_ok()    { echo -e "${GREEN}[OK]${NC} $1"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

ERRORS=()

# Detect OS
detect_os() {
    if [[ "$OSTYPE" == "linux-gnu"* ]]; then
        if command -v apt-get &>/dev/null; then
            OS="debian"
        elif command -v dnf &>/dev/null; then
            OS="fedora"
        else
            OS="linux_other"
        fi
    elif [[ "$OSTYPE" == "darwin"* ]]; then
        OS="macos"
    else
        log_error "Unsupported OS: $OSTYPE"
        exit 1
    fi
    log_info "Detected OS: $OS"
}

# ============================================================
# 1. NODE.JS 22+
# ============================================================
install_node() {
    log_info "Checking Node.js..."
    if command -v node &>/dev/null; then
        NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
        if [ "$NODE_VERSION" -ge 22 ]; then
            log_ok "Node.js v$(node -v) already installed"
            return
        else
            log_warn "Node.js v$(node -v) found but need v22+. Upgrading..."
        fi
    fi

    log_info "Installing Node.js 22..."
    if [ "$OS" = "debian" ]; then
        curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
        sudo apt-get install -y nodejs
    elif [ "$OS" = "macos" ]; then
        if command -v brew &>/dev/null; then
            brew install node@22
        else
            log_error "Homebrew not found. Install from https://brew.sh first"
            ERRORS+=("Node.js installation failed — no Homebrew")
            return
        fi
    fi

    if command -v node &>/dev/null; then
        log_ok "Node.js $(node -v) installed"
    else
        log_error "Node.js installation failed"
        ERRORS+=("Node.js")
    fi
}

# ============================================================
# 2. OPENCLAW
# ============================================================
install_openclaw() {
    log_info "Checking OpenClaw..."
    if command -v openclaw &>/dev/null; then
        log_ok "OpenClaw already installed: $(openclaw --version 2>/dev/null || echo 'version unknown')"
    else
        log_info "Installing OpenClaw globally..."
        npm install -g openclaw@latest
        if command -v openclaw &>/dev/null; then
            log_ok "OpenClaw installed successfully"
        else
            log_error "OpenClaw installation failed"
            ERRORS+=("OpenClaw")
        fi
    fi
}

# ============================================================
# 3. OLLAMA + OBLITERATUS MODEL
# ============================================================
install_ollama() {
    log_info "Checking Ollama..."
    if command -v ollama &>/dev/null; then
        log_ok "Ollama already installed"
    else
        log_info "Installing Ollama..."
        curl -fsSL https://ollama.com/install.sh | sh
        if command -v ollama &>/dev/null; then
            log_ok "Ollama installed"
        else
            log_error "Ollama installation failed"
            ERRORS+=("Ollama")
            return
        fi
    fi

    # Start Ollama service if not running
    if ! pgrep -x "ollama" &>/dev/null; then
        log_info "Starting Ollama service..."
        ollama serve &>/dev/null &
        sleep 3
    fi

    # Pull the Obliteratus model (uncensored for raw analysis)
    log_info "Pulling Obliteratus model (this may take a while on first run)..."
    if ollama list 2>/dev/null | grep -q "obliteratus"; then
        log_ok "Obliteratus model already downloaded"
    else
        # Obliteratus is an abliterated (uncensored) model
        # If not available on Ollama hub, fall back to a compatible uncensored model
        if ollama pull obliteratus 2>/dev/null; then
            log_ok "Obliteratus model pulled"
        else
            log_warn "Obliteratus not found on hub. Pulling dolphin-mistral as fallback..."
            ollama pull dolphin-mistral
            log_ok "dolphin-mistral pulled as fallback (update models.yaml to match)"
        fi
    fi
}

# ============================================================
# 4. NEO4J COMMUNITY EDITION (Native, NOT Docker)
# ============================================================
install_neo4j() {
    log_info "Checking Neo4j..."
    if command -v neo4j &>/dev/null || command -v cypher-shell &>/dev/null; then
        log_ok "Neo4j already installed"
        return
    fi

    log_info "Installing Neo4j Community Edition..."
    if [ "$OS" = "debian" ]; then
        # Add Neo4j repository
        wget -O - https://debian.neo4j.com/neotechnology.gpg.key | sudo gpg --dearmor -o /usr/share/keyrings/neo4j-archive-keyring.gpg
        echo "deb [signed-by=/usr/share/keyrings/neo4j-archive-keyring.gpg] https://debian.neo4j.com stable latest" | sudo tee /etc/apt/sources.list.d/neo4j.list
        sudo apt-get update
        sudo apt-get install -y neo4j
        
        # Enable and start Neo4j
        sudo systemctl enable neo4j
        sudo systemctl start neo4j
        log_ok "Neo4j installed and started as system service"
    elif [ "$OS" = "macos" ]; then
        if command -v brew &>/dev/null; then
            brew install neo4j
            brew services start neo4j
            log_ok "Neo4j installed and started via Homebrew"
        else
            log_error "Homebrew not found for Neo4j install"
            ERRORS+=("Neo4j")
            return
        fi
    fi

    # Wait for Neo4j to start
    log_info "Waiting for Neo4j to start (up to 30s)..."
    for i in {1..30}; do
        if curl -s http://localhost:7474 &>/dev/null; then
            log_ok "Neo4j is running on port 7474"
            break
        fi
        sleep 1
    done
}

# ============================================================
# 5. NEO4J SCHEMA MIGRATION
# ============================================================
run_neo4j_migration() {
    log_info "Running Neo4j schema migration..."
    
    MIGRATION_FILE="$SENTINEL_DIR/graph/neo4j-schema/migration.cypher"
    
    if [ ! -f "$MIGRATION_FILE" ] || [ ! -s "$MIGRATION_FILE" ]; then
        log_warn "Migration file empty or not found — will be populated when schema is written"
        return
    fi

    # Check if cypher-shell is available
    if command -v cypher-shell &>/dev/null; then
        NEO4J_USER="${NEO4J_USER:-neo4j}"
        NEO4J_PASS="${NEO4J_PASSWORD:-neo4j}"
        cat "$MIGRATION_FILE" | cypher-shell -u "$NEO4J_USER" -p "$NEO4J_PASS" 2>/dev/null && \
            log_ok "Schema migration complete" || \
            log_warn "Migration failed — you may need to set NEO4J_PASSWORD in .env first"
    else
        log_warn "cypher-shell not found — run migration manually after setting Neo4j password"
    fi
}

# ============================================================
# 6. OPENCLAW SKILLS (Off-the-shelf from ClawHub)
# ============================================================
install_skills() {
    log_info "Installing OpenClaw skills from ClawHub..."
    
    SKILLS=(
        "github"                  # GitHub API integration (61.6K downloads)
        "agent-browser"           # Headless browser for web scraping (61.1K downloads)
        "tavily-web-search"       # Web search for OSINT (76.3K downloads)
        "self-improving-agent"    # Self-improvement loop (87.6K downloads)
        "humanizer"               # Make text sound human (28.4K downloads)
        "summarize"               # Condense investigation findings (66.4K downloads)
    )

    for skill in "${SKILLS[@]}"; do
        log_info "Installing skill: $skill"
        if openclaw skill install "$skill" 2>/dev/null; then
            log_ok "Installed: $skill"
        else
            log_warn "Could not install $skill — may need manual install via: openclaw skill install $skill"
        fi
    done
}

# ============================================================
# 7. PYTHON DEPENDENCIES (for custom analysis scripts)
# ============================================================
install_python_deps() {
    log_info "Checking Python..."
    if command -v python3 &>/dev/null; then
        log_ok "Python3 found: $(python3 --version)"
    else
        log_warn "Python3 not found — some analysis features may not work"
        return
    fi

    if [ -f "$SENTINEL_DIR/requirements.txt" ]; then
        log_info "Installing Python dependencies..."
        python3 -m pip install -r "$SENTINEL_DIR/requirements.txt" --quiet
        log_ok "Python dependencies installed"
    fi
}

# ============================================================
# 8. ENVIRONMENT FILE
# ============================================================
setup_env() {
    log_info "Setting up environment file..."
    ENV_FILE="$SENTINEL_DIR/.env"
    EXAMPLE_FILE="$SENTINEL_DIR/infra/configs/.env.example"

    if [ -f "$ENV_FILE" ]; then
        log_ok ".env already exists — skipping (won't overwrite your config)"
    elif [ -f "$EXAMPLE_FILE" ]; then
        cp "$EXAMPLE_FILE" "$ENV_FILE"
        log_ok ".env created from template — EDIT THIS FILE with your API keys:"
        echo ""
        echo "  $ENV_FILE"
        echo ""
        echo "  Required keys:"
        echo "    HELIUS_API_KEY     — Get from https://helius.dev"
        echo "    TWITTER_USERNAME   — Sentinel's Twitter account"
        echo "    TWITTER_PASSWORD   — Twitter password"
        echo "    TELEGRAM_BOT_TOKEN — Create via @BotFather on Telegram"
        echo "    TELEGRAM_CHAT_ID   — Your chat ID for alerts"
        echo "    NEO4J_PASSWORD     — Set during Neo4j first-run"
        echo ""
    else
        log_warn "No .env.example found — creating minimal .env"
        cat > "$ENV_FILE" << 'EOF'
# Sentinel Environment Variables
HELIUS_API_KEY=
TWITTER_USERNAME=
TWITTER_PASSWORD=
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
NEO4J_URI=bolt://localhost:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=
OLLAMA_HOST=http://localhost:11434
CLAUDE_API_KEY=
EOF
        log_ok ".env created — fill in your API keys"
    fi
}

# ============================================================
# 9. SYSTEMD SERVICE FILES (Linux only)
# ============================================================
install_systemd() {
    if [ "$OS" != "debian" ] && [ "$OS" != "fedora" ]; then
        log_info "Skipping systemd setup (not Linux)"
        return
    fi

    log_info "Installing systemd service files..."

    # Main Sentinel service
    sudo cp "$SENTINEL_DIR/infra/systemd/openclaw-sentinel.service" /etc/systemd/system/ 2>/dev/null && \
        log_ok "Installed openclaw-sentinel.service" || \
        log_warn "Could not install sentinel service"

    # Watchdog timer
    sudo cp "$SENTINEL_DIR/infra/systemd/sentinel-watchdog.service" /etc/systemd/system/ 2>/dev/null && \
        log_ok "Installed sentinel-watchdog.service" || \
        log_warn "Could not install watchdog service"

    # Create watchdog timer unit
    cat << 'EOF' | sudo tee /etc/systemd/system/sentinel-watchdog.timer > /dev/null
[Unit]
Description=Sentinel Watchdog Timer
Requires=sentinel-watchdog.service

[Timer]
OnBootSec=5min
OnUnitActiveSec=5min
AccuracySec=1min

[Install]
WantedBy=timers.target
EOF
    log_ok "Installed sentinel-watchdog.timer"

    sudo systemctl daemon-reload
    log_ok "Systemd units loaded"
    
    echo ""
    log_info "To start Sentinel:"
    echo "  sudo systemctl start openclaw-sentinel"
    echo "  sudo systemctl enable openclaw-sentinel  # auto-start on boot"
    echo "  sudo systemctl start sentinel-watchdog.timer"
    echo ""
}

# ============================================================
# 10. VALIDATION
# ============================================================
validate() {
    echo ""
    echo "============================================"
    echo "  SENTINEL SETUP VALIDATION"
    echo "============================================"
    echo ""

    CHECKS=0
    PASSED=0

    check() {
        CHECKS=$((CHECKS + 1))
        if eval "$2" &>/dev/null; then
            echo -e "  ${GREEN}[PASS]${NC} $1"
            PASSED=$((PASSED + 1))
        else
            echo -e "  ${RED}[FAIL]${NC} $1"
        fi
    }

    check "Node.js 22+"           "node -v | grep -qE 'v2[2-9]|v[3-9][0-9]'"
    check "OpenClaw installed"     "command -v openclaw"
    check "Ollama running"         "curl -s http://localhost:11434/api/tags"
    check "Neo4j running"          "curl -s http://localhost:7474"
    check "Python3 available"      "command -v python3"
    check ".env file exists"       "test -f $SENTINEL_DIR/.env"
    check "SOUL.md exists"         "test -s $SENTINEL_DIR/agent/SOUL.md"
    check "HEARTBEAT.md exists"    "test -s $SENTINEL_DIR/agent/HEARTBEAT.md"

    echo ""
    echo "============================================"
    echo "  $PASSED / $CHECKS checks passed"
    echo "============================================"
    echo ""

    if [ ${#ERRORS[@]} -gt 0 ]; then
        log_warn "Some components had issues:"
        for err in "${ERRORS[@]}"; do
            echo "  - $err"
        done
        echo ""
    fi

    if [ "$PASSED" -ge 6 ]; then
        echo -e "${GREEN}"
        echo "  Sentinel is ready to deploy."
        echo "  "
        echo "  Next steps:"
        echo "    1. Edit .env with your API keys"
        echo "    2. Set Neo4j password (first login at http://localhost:7474)"
        echo "    3. Run: openclaw gateway start"
        echo "    4. Sentinel is alive."
        echo -e "${NC}"
    else
        echo -e "${RED}"
        echo "  Setup incomplete. Fix the failed checks above and re-run."
        echo -e "${NC}"
    fi
}

# ============================================================
# MAIN
# ============================================================
main() {
    echo ""
    echo "============================================"
    echo "  SENTINEL SETUP — No Docker Required"
    echo "  Autonomous Solana Forensics Agent"
    echo "============================================"
    echo ""

    detect_os
    install_node
    install_openclaw
    install_ollama
    install_neo4j
    run_neo4j_migration
    install_skills
    install_python_deps
    setup_env
    install_systemd
    validate
}

main "$@"
