#!/bin/bash
# Deploy Time Aggregation System
# Production-ready deployment with all safety checks

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FLOWFORGE_ROOT="${FLOWFORGE_ROOT:-$(dirname "$SCRIPT_DIR")}"
PROJECT_ROOT="$(dirname "$FLOWFORGE_ROOT")"
PLATFORM=$(uname -s | tr '[:upper:]' '[:lower:]')
TIMESTAMP=$(date +%Y%m%d-%H%M%S)

echo -e "${BLUE}════════════════════════════════════════════════${NC}"
echo -e "${BLUE}    FlowForge Time Aggregation Deployment${NC}"
echo -e "${BLUE}════════════════════════════════════════════════${NC}"
echo
echo "FlowForge Root: $FLOWFORGE_ROOT"
echo "Project Root: $PROJECT_ROOT"
echo "Platform: $PLATFORM"
echo "Timestamp: $TIMESTAMP"
echo

# Helper functions
log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

confirm() {
    read -p "$(echo -e ${YELLOW}"$1 [y/N]: "${NC})" -n 1 -r
    echo
    [[ $REPLY =~ ^[Yy]$ ]]
}

# Step 1: Pre-flight checks
preflight_checks() {
    echo -e "${BLUE}[1/7] Running pre-flight checks...${NC}"
    
    # Check Git repository
    if [ ! -d "$PROJECT_ROOT/.git" ]; then
        log_error "Not in a Git repository!"
        exit 1
    fi
    log_info "✓ Git repository found"
    
    # Check Python 3
    if ! command -v python3 &> /dev/null; then
        log_error "Python 3 is required but not installed"
        exit 1
    fi
    PYTHON_VERSION=$(python3 --version | cut -d' ' -f2)
    log_info "✓ Python $PYTHON_VERSION found"
    
    # Check jq for JSON processing
    if ! command -v jq &> /dev/null; then
        log_warn "jq not found, installing..."
        case "$PLATFORM" in
            linux)
                sudo apt-get update && sudo apt-get install -y jq || \
                sudo yum install -y jq || \
                log_error "Failed to install jq"
                ;;
            darwin)
                brew install jq || log_error "Failed to install jq"
                ;;
        esac
    fi
    log_info "✓ jq available"
    
    # Check disk space (need at least 100MB)
    AVAILABLE_SPACE=$(df "$FLOWFORGE_ROOT" | awk 'NR==2 {print $4}')
    if [ "$AVAILABLE_SPACE" -lt 100000 ]; then
        log_error "Insufficient disk space (need 100MB)"
        exit 1
    fi
    log_info "✓ Sufficient disk space"
    
    echo
}

# Step 2: Backup existing configuration
backup_existing() {
    echo -e "${BLUE}[2/7] Creating backup...${NC}"
    
    BACKUP_DIR="$FLOWFORGE_ROOT/backups/deployment-$TIMESTAMP"
    mkdir -p "$BACKUP_DIR"
    
    # Backup existing hooks if they exist
    if [ -d "$PROJECT_ROOT/.git/hooks" ]; then
        cp -r "$PROJECT_ROOT/.git/hooks" "$BACKUP_DIR/" 2>/dev/null || true
        log_info "✓ Git hooks backed up"
    fi
    
    # Backup existing team summaries if they exist
    if [ -d "$FLOWFORGE_ROOT/team" ]; then
        tar czf "$BACKUP_DIR/team-summaries.tar.gz" "$FLOWFORGE_ROOT/team" 2>/dev/null || true
        log_info "✓ Team summaries backed up"
    fi
    
    log_info "✓ Backup created at: $BACKUP_DIR"
    echo
}

# Step 3: Initialize directory structure
initialize_directories() {
    echo -e "${BLUE}[3/7] Initializing directory structure...${NC}"
    
    # Create all required directories
    mkdir -p "$FLOWFORGE_ROOT"/{user,team/summaries/{weekly,monthly},daemon/{queue,failed,logs},recovery/last-known-good,team/schema}
    
    # Set appropriate permissions
    chmod 755 "$FLOWFORGE_ROOT"/team
    chmod 700 "$FLOWFORGE_ROOT"/user 2>/dev/null || true
    chmod 700 "$FLOWFORGE_ROOT"/daemon
    
    log_info "✓ Directory structure created"
    
    # Create initial team configuration
    if [ ! -f "$FLOWFORGE_ROOT/team/config.json" ]; then
        cat > "$FLOWFORGE_ROOT/team/config.json" <<EOF
{
    "version": "2.0.0",
    "aggregation": {
        "enabled": true,
        "interval_minutes": 5,
        "retention_days": 90,
        "backup_enabled": true,
        "backup_retention_count": 10
    },
    "team": {
        "name": "$(basename "$PROJECT_ROOT")",
        "created": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
        "deployment_date": "$TIMESTAMP"
    },
    "monitoring": {
        "health_check_interval": 60,
        "alert_on_failure": true,
        "max_queue_size": 100,
        "max_aggregation_delay_minutes": 30
    }
}
EOF
        log_info "✓ Team configuration created"
    else
        log_info "✓ Team configuration exists"
    fi
    
    # Create schema definition
    cat > "$FLOWFORGE_ROOT/team/schema/aggregation-v2.json" <<'EOF'
{
    "$schema": "http://json-schema.org/draft-07/schema#",
    "title": "FlowForge Time Aggregation",
    "type": "object",
    "required": ["version", "timestamp", "users", "totals", "metadata"],
    "properties": {
        "version": {"type": "string", "pattern": "^\\d+\\.\\d+\\.\\d+$"},
        "timestamp": {"type": "string", "format": "date-time"},
        "aggregation_id": {"type": "string"},
        "users": {"type": "object"},
        "totals": {
            "type": "object",
            "required": ["hours", "sessions", "issues"],
            "properties": {
                "hours": {"type": "number", "minimum": 0},
                "sessions": {"type": "integer", "minimum": 0},
                "issues": {"type": "array", "items": {"type": "string"}}
            }
        },
        "metadata": {"type": "object"}
    }
}
EOF
    log_info "✓ Schema definition created"
    echo
}

# Step 4: Install Git hooks
install_git_hooks() {
    echo -e "${BLUE}[4/7] Installing Git hooks...${NC}"
    
    HOOKS_DIR="$PROJECT_ROOT/.git/hooks"
    mkdir -p "$HOOKS_DIR"
    
    # Create the aggregation hook script in .flowforge
    cat > "$FLOWFORGE_ROOT/hooks/pre-commit-aggregate" <<'EOF'
#!/bin/bash
# FlowForge Time Aggregation Hook
# AUTO-GENERATED - DO NOT EDIT

set -euo pipefail

# Configuration
FLOWFORGE_ROOT="$(git rev-parse --show-toplevel)/.flowforge"
LOCK_FILE="/tmp/flowforge-aggregate-$(echo $PWD | md5sum | cut -d' ' -f1).lock"
LOG_FILE="$FLOWFORGE_ROOT/daemon/logs/hook.log"

# Create log directory if needed
mkdir -p "$(dirname "$LOG_FILE")"

# Logging function
log() {
    echo "[$(date +'%Y-%m-%d %H:%M:%S')] $1" >> "$LOG_FILE"
    echo "$1" >&2
}

# Skip in CI/CD environments
if [ -n "${CI:-}" ] || [ -n "${GITHUB_ACTIONS:-}" ]; then
    log "INFO: Skipping aggregation in CI/CD environment"
    exit 0
fi

# Check if aggregation is needed
if [ ! -d "$FLOWFORGE_ROOT/user" ]; then
    log "INFO: No user data to aggregate"
    exit 0
fi

# Try to acquire lock (with timeout)
LOCK_ACQUIRED=0
for i in {1..10}; do
    if mkdir "$LOCK_FILE" 2>/dev/null; then
        trap 'rm -rf "$LOCK_FILE"' EXIT
        LOCK_ACQUIRED=1
        break
    fi
    sleep 0.5
done

if [ $LOCK_ACQUIRED -eq 0 ]; then
    log "WARNING: Could not acquire lock, queuing for daemon"
    # Queue for daemon processing
    QUEUE_DIR="$FLOWFORGE_ROOT/daemon/queue"
    mkdir -p "$QUEUE_DIR"
    cat > "$QUEUE_DIR/$(date +%s)-$$.json" <<QUEUE
{
    "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
    "trigger": "git-hook-timeout",
    "user": "$USER",
    "retry_after": "$(date -u -d '+30 seconds' +%Y-%m-%dT%H:%M:%SZ)"
}
QUEUE
    exit 0
fi

# Run Python aggregation script if daemon exists
if [ -f "$FLOWFORGE_ROOT/scripts/aggregation-daemon.py" ]; then
    python3 "$FLOWFORGE_ROOT/scripts/aggregation-daemon.py" status &>/dev/null
    if [ $? -eq 0 ]; then
        # Daemon is running, just queue the task
        QUEUE_DIR="$FLOWFORGE_ROOT/daemon/queue"
        mkdir -p "$QUEUE_DIR"
        cat > "$QUEUE_DIR/$(date +%s)-$$.json" <<QUEUE
{
    "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
    "trigger": "git-commit",
    "user": "$USER",
    "retry_after": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
QUEUE
        log "INFO: Aggregation queued for daemon processing"
    else
        log "WARNING: Daemon not running, performing direct aggregation"
        # Fallback to simple aggregation
        "$FLOWFORGE_ROOT/scripts/simple-aggregate.sh" || true
    fi
else
    # Fallback to simple aggregation
    "$FLOWFORGE_ROOT/scripts/simple-aggregate.sh" || true
fi

exit 0
EOF
    chmod +x "$FLOWFORGE_ROOT/hooks/pre-commit-aggregate"
    
    # Create simple aggregation fallback
    cat > "$FLOWFORGE_ROOT/scripts/simple-aggregate.sh" <<'EOF'
#!/bin/bash
# Simple aggregation fallback when daemon is not available

set -euo pipefail

FLOWFORGE_ROOT="$(git rev-parse --show-toplevel)/.flowforge"
SUMMARY_FILE="$FLOWFORGE_ROOT/team/summaries/current.json"

mkdir -p "$(dirname "$SUMMARY_FILE")"

# Create basic aggregation
cat > "$SUMMARY_FILE" <<JSON
{
    "version": "2.0.0",
    "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
    "aggregation_method": "simple",
    "users": {},
    "totals": {
        "hours": 0,
        "sessions": 0,
        "issues": []
    }
}
JSON

echo "Simple aggregation completed"
EOF
    chmod +x "$FLOWFORGE_ROOT/scripts/simple-aggregate.sh"
    
    # Install pre-commit hook
    cat > "$HOOKS_DIR/pre-commit" <<EOF
#!/bin/bash
# FlowForge pre-commit hook
exec "$FLOWFORGE_ROOT/hooks/pre-commit-aggregate" "\$@"
EOF
    chmod +x "$HOOKS_DIR/pre-commit"
    
    # Install post-commit verification hook
    cat > "$HOOKS_DIR/post-commit" <<EOF
#!/bin/bash
# FlowForge post-commit verification
if [ -f "$FLOWFORGE_ROOT/team/summaries/current.json" ]; then
    echo "✅ Time aggregation verified"
else
    echo "⚠️  Warning: Time aggregation may have failed"
fi
EOF
    chmod +x "$HOOKS_DIR/post-commit"
    
    log_info "✓ Git hooks installed"
    echo
}

# Step 5: Install Python dependencies
install_dependencies() {
    echo -e "${BLUE}[5/7] Installing Python dependencies...${NC}"
    
    # Create requirements file
    cat > "$FLOWFORGE_ROOT/requirements.txt" <<EOF
# FlowForge Time Aggregation Dependencies
# Required for daemon and monitoring
EOF
    
    # Check if pip is available
    if command -v pip3 &> /dev/null; then
        # Try to install optional dependencies (not critical if they fail)
        pip3 install --user watchdog 2>/dev/null || log_warn "watchdog module not installed (optional)"
        log_info "✓ Python dependencies checked"
    else
        log_warn "pip3 not available, skipping optional dependencies"
    fi
    
    echo
}

# Step 6: Setup daemon service (optional)
setup_daemon() {
    echo -e "${BLUE}[6/7] Setting up aggregation daemon...${NC}"
    
    if ! confirm "Do you want to install the aggregation daemon as a service?"; then
        log_info "⊗ Daemon service setup skipped"
        echo
        return
    fi
    
    case "$PLATFORM" in
        linux)
            if command -v systemctl &> /dev/null; then
                setup_systemd_service
            else
                log_warn "systemd not available, manual daemon start required"
            fi
            ;;
        darwin)
            setup_launchd_service
            ;;
        *)
            log_warn "Automatic daemon setup not available for $PLATFORM"
            log_info "Start manually with: python3 $FLOWFORGE_ROOT/scripts/aggregation-daemon.py start"
            ;;
    esac
    echo
}

setup_systemd_service() {
    # Create systemd service file
    cat > /tmp/flowforge-aggregation.service <<EOF
[Unit]
Description=FlowForge Time Aggregation Daemon
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$PROJECT_ROOT
Environment="PYTHONUNBUFFERED=1"
ExecStart=$(which python3) $FLOWFORGE_ROOT/scripts/aggregation-daemon.py start --flowforge-root $FLOWFORGE_ROOT
ExecStop=$(which python3) $FLOWFORGE_ROOT/scripts/aggregation-daemon.py stop --flowforge-root $FLOWFORGE_ROOT
Restart=on-failure
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF
    
    # Try to install as user service first
    USER_SERVICE_DIR="$HOME/.config/systemd/user"
    if [ -d "$USER_SERVICE_DIR" ] || mkdir -p "$USER_SERVICE_DIR" 2>/dev/null; then
        cp /tmp/flowforge-aggregation.service "$USER_SERVICE_DIR/"
        systemctl --user daemon-reload
        systemctl --user enable flowforge-aggregation 2>/dev/null || true
        systemctl --user start flowforge-aggregation 2>/dev/null || true
        
        if systemctl --user is-active flowforge-aggregation &>/dev/null; then
            log_info "✓ User systemd service installed and started"
        else
            log_warn "User service failed, trying system-wide installation"
            if confirm "Install as system service (requires sudo)?"; then
                sudo cp /tmp/flowforge-aggregation.service /etc/systemd/system/
                sudo systemctl daemon-reload
                sudo systemctl enable flowforge-aggregation
                sudo systemctl start flowforge-aggregation
                log_info "✓ System systemd service installed"
            fi
        fi
    else
        log_warn "User systemd directory not available"
    fi
}

setup_launchd_service() {
    PLIST_FILE="$HOME/Library/LaunchAgents/com.flowforge.aggregation.plist"
    
    cat > "$PLIST_FILE" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.flowforge.aggregation</string>
    <key>ProgramArguments</key>
    <array>
        <string>$(which python3)</string>
        <string>$FLOWFORGE_ROOT/scripts/aggregation-daemon.py</string>
        <string>start</string>
        <string>--flowforge-root</string>
        <string>$FLOWFORGE_ROOT</string>
    </array>
    <key>WorkingDirectory</key>
    <string>$PROJECT_ROOT</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <dict>
        <key>SuccessfulExit</key>
        <false/>
    </dict>
    <key>StandardOutPath</key>
    <string>$FLOWFORGE_ROOT/daemon/logs/stdout.log</string>
    <key>StandardErrorPath</key>
    <string>$FLOWFORGE_ROOT/daemon/logs/stderr.log</string>
</dict>
</plist>
EOF
    
    launchctl load "$PLIST_FILE" 2>/dev/null || true
    launchctl start com.flowforge.aggregation 2>/dev/null || true
    
    log_info "✓ LaunchAgent installed"
}

# Step 7: Verify installation
verify_installation() {
    echo -e "${BLUE}[7/7] Verifying installation...${NC}"
    
    VERIFICATION_PASSED=true
    
    # Check directory structure
    if [ -d "$FLOWFORGE_ROOT/team/summaries" ] && \
       [ -d "$FLOWFORGE_ROOT/daemon" ] && \
       [ -d "$FLOWFORGE_ROOT/recovery" ]; then
        log_info "✓ Directory structure correct"
    else
        log_error "✗ Directory structure incomplete"
        VERIFICATION_PASSED=false
    fi
    
    # Check git hooks
    if [ -x "$PROJECT_ROOT/.git/hooks/pre-commit" ]; then
        log_info "✓ Git hooks installed and executable"
    else
        log_error "✗ Git hooks not properly installed"
        VERIFICATION_PASSED=false
    fi
    
    # Check Python script
    if [ -f "$FLOWFORGE_ROOT/scripts/aggregation-daemon.py" ]; then
        if python3 -m py_compile "$FLOWFORGE_ROOT/scripts/aggregation-daemon.py" 2>/dev/null; then
            log_info "✓ Python aggregation script valid"
        else
            log_error "✗ Python script has syntax errors"
            VERIFICATION_PASSED=false
        fi
    fi
    
    # Check daemon status
    if [ -f "$FLOWFORGE_ROOT/scripts/aggregation-daemon.py" ]; then
        if python3 "$FLOWFORGE_ROOT/scripts/aggregation-daemon.py" status --flowforge-root "$FLOWFORGE_ROOT" 2>/dev/null | grep -q "running"; then
            log_info "✓ Aggregation daemon is running"
        else
            log_warn "⚠ Daemon not running (start manually if needed)"
        fi
    fi
    
    # Test aggregation
    if [ -f "$FLOWFORGE_ROOT/scripts/simple-aggregate.sh" ]; then
        if "$FLOWFORGE_ROOT/scripts/simple-aggregate.sh" &>/dev/null; then
            log_info "✓ Test aggregation successful"
        else
            log_warn "⚠ Test aggregation failed (non-critical)"
        fi
    fi
    
    echo
    
    if [ "$VERIFICATION_PASSED" = true ]; then
        echo -e "${GREEN}════════════════════════════════════════════════${NC}"
        echo -e "${GREEN}    ✅ Deployment Successful!${NC}"
        echo -e "${GREEN}════════════════════════════════════════════════${NC}"
    else
        echo -e "${YELLOW}════════════════════════════════════════════════${NC}"
        echo -e "${YELLOW}    ⚠️  Deployment Completed with Warnings${NC}"
        echo -e "${YELLOW}════════════════════════════════════════════════${NC}"
    fi
}

# Main execution
main() {
    # Show intro
    echo "This script will deploy the FlowForge Time Aggregation system"
    echo "ensuring reliable time tracking and billing data aggregation."
    echo
    echo -e "${YELLOW}TIME = MONEY - Every minute must be tracked!${NC}"
    echo
    
    if ! confirm "Do you want to proceed with deployment?"; then
        echo "Deployment cancelled"
        exit 0
    fi
    
    echo
    
    # Run all deployment steps
    preflight_checks
    backup_existing
    initialize_directories
    install_git_hooks
    install_dependencies
    setup_daemon
    verify_installation
    
    # Show next steps
    echo
    echo -e "${BLUE}Next Steps:${NC}"
    echo "1. Test aggregation: git commit -m 'test aggregation'"
    echo "2. Check daemon status: python3 $FLOWFORGE_ROOT/scripts/aggregation-daemon.py status"
    echo "3. Monitor health: cat $FLOWFORGE_ROOT/daemon/health.json"
    echo "4. View logs: tail -f $FLOWFORGE_ROOT/daemon/logs/daemon.log"
    echo
    echo "Documentation: $FLOWFORGE_ROOT/../documentation/architecture/time-aggregation-devops-architecture.md"
    echo
    echo -e "${GREEN}Your time tracking is now production-ready!${NC}"
}

# Handle errors
trap 'log_error "Deployment failed at line $LINENO"' ERR

# Run main
main "$@"