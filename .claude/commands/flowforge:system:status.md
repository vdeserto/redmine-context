# Command: flowforge:system:status
# Version: 2.0.0
# Description: FlowForge system status command

---
description: Show FlowForge system status and health
---

# 🖥️  FlowForge System Status

## 📚 Show Help
```bash
# Check if help is requested FIRST (before strict mode)
if [[ "${ARGUMENTS:-}" == "?" || "${ARGUMENTS:-}" == "help" ]]; then
    cat << 'EOF'
🖥️  FlowForge System Status

Comprehensive system health check for FlowForge installation and dependencies.

Usage: /flowforge:system:status [options]

Options:
  (none)         Show standard system status overview
  --verbose      Show detailed system information
  --brief        Show only essential status
  help, ?        Show this help message

Sections shown:
  • FlowForge installation status
  • System dependencies (git, node, bash, etc.)
  • System resources (disk, memory)
  • Configuration validation
  • Network connectivity (optional)
  • Overall health summary

Examples:
  /flowforge:system:status              # Standard overview
  /flowforge:system:status --verbose    # Detailed information
  /flowforge:system:status --brief      # Quick summary
EOF
    exit 0
fi
```

## 🔧 Setup Error Handling
```bash
# Now enable strict error handling
set -euo pipefail

# Error handler function
handle_error() {
    local exit_code=$?
    local line_number=$1
    echo "❌ Error on line $line_number (exit code: $exit_code)"
    
    # Context-specific error messages
    if [[ "${BASH_COMMAND:-}" =~ "git" ]]; then
        echo "💡 Git command failed - ensure git is installed and accessible"
        echo "   Try: which git"
    elif [[ "${BASH_COMMAND:-}" =~ "node\|npm" ]]; then
        echo "💡 Node.js command failed - check Node.js installation"
        echo "   Try: node --version && npm --version"
    elif [[ "${BASH_COMMAND:-}" =~ "df\|du" ]]; then
        echo "💡 Disk space command failed - permission or filesystem issue"
        echo "   Try: df -h ."
    elif [[ "${BASH_COMMAND:-}" =~ "jq" ]]; then
        echo "💡 JSON parsing failed - jq not available or invalid JSON"
        echo "   Install jq or check file format"
    elif [[ "${BASH_COMMAND:-}" =~ "curl\|wget" ]]; then
        echo "💡 Network command failed - connectivity or tool missing"
        echo "   Check internet connection and tool availability"
    fi
    
    exit $exit_code
}

# Set error trap
trap 'handle_error $LINENO' ERR

# Enable debug mode if DEBUG=1
[[ "${DEBUG:-0}" == "1" ]] && set -x
```

## 🔍 Parse Options
```bash
# Initialize options
VERBOSE=false
BRIEF=false

# Parse arguments
for arg in ${ARGUMENTS:-}; do
    case "$arg" in
        --verbose) VERBOSE=true ;;
        --brief) BRIEF=true ;;
        --*) 
            echo "⚠️  Unknown option: $arg"
            echo "   Use 'help' to see available options"
            ;;
    esac
done
```

## 🖥️  Main System Status Display
```bash
# Header
echo "🖥️  FlowForge System Status"
echo "=========================="
echo ""

# FlowForge Installation Section
echo "🚀 FlowForge Installation"
echo "-------------------------"

# Check FlowForge version
FLOWFORGE_VERSION="unknown"
if [ -f ".flowforge-version.json" ]; then
    if command -v jq &> /dev/null; then
        FLOWFORGE_VERSION=$(jq -r '.version // "unknown"' .flowforge-version.json 2>/dev/null || echo "parse_error")
        if [ "$FLOWFORGE_VERSION" = "parse_error" ]; then
            echo "⚠️  Version file exists but invalid JSON format"
            FLOWFORGE_VERSION="unknown"
        else
            echo "Version: $FLOWFORGE_VERSION"
            if [ "$VERBOSE" = "true" ]; then
                INSTALL_DATE=$(jq -r '.installation_date // "unknown"' .flowforge-version.json 2>/dev/null || echo "unknown")
                LAST_UPDATED=$(jq -r '.last_updated // "unknown"' .flowforge-version.json 2>/dev/null || echo "unknown")
                echo "Installed: $INSTALL_DATE"
                echo "Last updated: $LAST_UPDATED"
            fi
        fi
    else
        echo "⚠️  jq not available - cannot parse version file"
        FLOWFORGE_VERSION="jq_missing"
    fi
elif [ -f ".flowforge/version" ]; then
    # Fallback to plain text version file
    FLOWFORGE_VERSION=$(cat .flowforge/version 2>/dev/null || echo "read_error")
    echo "Version: $FLOWFORGE_VERSION"
else
    echo "❌ FlowForge version file not found"
    echo "   Expected: .flowforge-version.json or .flowforge/version"
fi

# Check FlowForge structure
FLOWFORGE_STRUCTURE_OK=true
for dir in ".flowforge" "commands" "scripts"; do
    if [ -d "$dir" ]; then
        echo "✅ $dir/ directory present"
    else
        echo "❌ $dir/ directory missing"
        FLOWFORGE_STRUCTURE_OK=false
    fi
done

# System Dependencies Section
echo ""
echo "🔧 System Dependencies"
echo "----------------------"

# Track dependency health
DEPS_OK=0
DEPS_TOTAL=0

# Check bash version
if command -v bash &> /dev/null; then
    BASH_VERSION=$(bash --version | head -1 | cut -d' ' -f4 | cut -d'(' -f1 2>/dev/null || echo "unknown")
    echo "✅ bash: $BASH_VERSION"
    ((DEPS_OK++)) || true
else
    echo "❌ bash: not found"
fi
((DEPS_TOTAL++)) || true

# Check git
if command -v git &> /dev/null; then
    GIT_VERSION=$(git --version | cut -d' ' -f3 2>/dev/null || echo "unknown")
    echo "✅ git: $GIT_VERSION"
    ((DEPS_OK++)) || true
    
    # Check git config in verbose mode
    if [ "$VERBOSE" = "true" ]; then
        GIT_USER=$(git config --global user.name 2>/dev/null || echo "not set")
        GIT_EMAIL=$(git config --global user.email 2>/dev/null || echo "not set")
        echo "   User: $GIT_USER"
        echo "   Email: $GIT_EMAIL"
    fi
else
    echo "❌ git: not found"
fi
((DEPS_TOTAL++)) || true

# Check node.js
if command -v node &> /dev/null; then
    NODE_VERSION=$(node --version 2>/dev/null || echo "unknown")
    echo "✅ node: $NODE_VERSION"
    ((DEPS_OK++)) || true
else
    echo "⚠️  node: not found (optional for some features)"
fi
((DEPS_TOTAL++)) || true

# Check npm
if command -v npm &> /dev/null; then
    NPM_VERSION=$(npm --version 2>/dev/null || echo "unknown")
    echo "✅ npm: $NPM_VERSION"
    ((DEPS_OK++)) || true
else
    echo "⚠️  npm: not found (optional for some features)"
fi
((DEPS_TOTAL++)) || true

# Check jq
if command -v jq &> /dev/null; then
    JQ_VERSION=$(jq --version 2>/dev/null || echo "unknown")
    echo "✅ jq: $JQ_VERSION"
    ((DEPS_OK++)) || true
else
    echo "⚠️  jq: not found (limits JSON parsing)"
fi
((DEPS_TOTAL++)) || true

# Check curl
if command -v curl &> /dev/null; then
    CURL_VERSION=$(curl --version | head -1 | cut -d' ' -f2 2>/dev/null || echo "unknown")
    echo "✅ curl: $CURL_VERSION"
    ((DEPS_OK++)) || true
else
    echo "⚠️  curl: not found (limits update functionality)"
fi
((DEPS_TOTAL++)) || true

# System Resources Section
echo ""
echo "💾 System Resources" 
echo "-------------------"

# Disk space check
if command -v df &> /dev/null; then
    DISK_INFO=$(df -h . 2>/dev/null | tail -1 || echo "error")
    if [ "$DISK_INFO" != "error" ]; then
        DISK_USED=$(echo "$DISK_INFO" | awk '{print $5}' | tr -d '%')
        DISK_AVAIL=$(echo "$DISK_INFO" | awk '{print $4}')
        echo "Disk space: $DISK_AVAIL available (${DISK_USED}% used)"
        
        # Warn if disk is getting full
        if [ "$DISK_USED" -gt 90 ]; then
            echo "⚠️  Disk space is critically low!"
        elif [ "$DISK_USED" -gt 80 ]; then
            echo "⚠️  Disk space is getting low"
        fi
    else
        echo "❌ Cannot determine disk space"
    fi
else
    echo "❌ df command not available"
fi

# Memory check (if available)
if [ -f "/proc/meminfo" ] && [ "$VERBOSE" = "true" ]; then
    TOTAL_MEM=$(grep MemTotal /proc/meminfo | awk '{print int($2/1024)}' 2>/dev/null || echo "unknown")
    AVAIL_MEM=$(grep MemAvailable /proc/meminfo | awk '{print int($2/1024)}' 2>/dev/null || echo "unknown")
    if [ "$TOTAL_MEM" != "unknown" ] && [ "$AVAIL_MEM" != "unknown" ]; then
        echo "Memory: ${AVAIL_MEM}MB available / ${TOTAL_MEM}MB total"
    fi
elif command -v free &> /dev/null && [ "$VERBOSE" = "true" ]; then
    TOTAL_MEM=$(free -m | grep '^Mem:' | awk '{print $2}' 2>/dev/null || echo "unknown")
    AVAIL_MEM=$(free -m | grep '^Mem:' | awk '{print $7}' 2>/dev/null || echo "unknown")
    if [ "$TOTAL_MEM" != "unknown" ] && [ "$AVAIL_MEM" != "unknown" ]; then
        echo "Memory: ${AVAIL_MEM}MB available / ${TOTAL_MEM}MB total"
    fi
fi

# Load average (if available)
if [ -f "/proc/loadavg" ] && [ "$VERBOSE" = "true" ]; then
    LOAD_AVG=$(cut -d' ' -f1-3 /proc/loadavg 2>/dev/null || echo "unknown")
    echo "Load average: $LOAD_AVG"
elif command -v uptime &> /dev/null && [ "$VERBOSE" = "true" ]; then
    LOAD_AVG=$(uptime | grep -o 'load average.*' 2>/dev/null || echo "unknown")
    echo "$LOAD_AVG"
fi

# Configuration Validation Section
echo ""
echo "⚙️  Configuration"
echo "-----------------"

CONFIG_OK=true

# Check for FlowForge config
if [ -f ".flowforge/config.json" ]; then
    if command -v jq &> /dev/null; then
        if jq empty .flowforge/config.json 2>/dev/null; then
            echo "✅ FlowForge config file valid"
        else
            echo "❌ FlowForge config file invalid JSON"
            CONFIG_OK=false
        fi
    else
        echo "⚠️  Cannot validate config file (jq missing)"
    fi
elif [ -f ".flowforge/config" ]; then
    echo "✅ FlowForge config file present (plain text)"
else
    echo "ℹ️  No FlowForge config file found"
fi

# Check git repository
if command -v git &> /dev/null && git rev-parse --git-dir &> /dev/null 2>&1; then
    echo "✅ Git repository initialized"
    if [ "$VERBOSE" = "true" ]; then
        CURRENT_BRANCH=$(git branch --show-current 2>/dev/null || echo "unknown")
        echo "   Current branch: $CURRENT_BRANCH"
        REMOTE_COUNT=$(git remote | wc -l 2>/dev/null || echo "0")
        echo "   Remotes configured: $REMOTE_COUNT"
    fi
else
    echo "ℹ️  Not in a git repository (optional)"
fi

# Network Connectivity Section (optional)
if [ "$VERBOSE" = "true" ]; then
    echo ""
    echo "🌐 Network Connectivity"
    echo "-----------------------"
    
    # Test GitHub connectivity (important for FlowForge updates)
    if command -v curl &> /dev/null; then
        if curl -s --connect-timeout 5 --max-time 10 https://api.github.com/zen > /dev/null 2>&1; then
            echo "✅ GitHub API accessible"
        else
            echo "⚠️  GitHub API not accessible (check internet connection)"
        fi
    elif command -v wget &> /dev/null; then
        if wget -q --timeout=5 --tries=1 -O /dev/null https://api.github.com/zen 2>/dev/null; then
            echo "✅ GitHub API accessible"
        else
            echo "⚠️  GitHub API not accessible (check internet connection)"
        fi
    else
        echo "ℹ️  Cannot test network connectivity (curl/wget missing)"
    fi
fi

# System Health Summary
if [ "$BRIEF" != "true" ]; then
    echo ""
    echo "📊 System Health Summary"
    echo "------------------------"
    
    # Calculate overall health score
    HEALTH_SCORE=0
    HEALTH_ITEMS=0
    
    # FlowForge installation health
    if [ "$FLOWFORGE_VERSION" != "unknown" ] && [ "$FLOWFORGE_VERSION" != "parse_error" ]; then
        ((HEALTH_SCORE++)) || true
        echo "✅ FlowForge version detected"
    else
        echo "❌ FlowForge version unclear"
    fi
    ((HEALTH_ITEMS++)) || true
    
    # Directory structure health
    if [ "$FLOWFORGE_STRUCTURE_OK" = "true" ]; then
        ((HEALTH_SCORE++)) || true
        echo "✅ FlowForge structure complete"
    else
        echo "❌ FlowForge structure incomplete"
    fi
    ((HEALTH_ITEMS++)) || true
    
    # Dependencies health
    DEP_PERCENT=$((DEPS_OK * 100 / DEPS_TOTAL))
    if [ "$DEP_PERCENT" -gt 80 ]; then
        ((HEALTH_SCORE++)) || true
        echo "✅ System dependencies ($DEPS_OK/$DEPS_TOTAL available)"
    else
        echo "⚠️  System dependencies incomplete ($DEPS_OK/$DEPS_TOTAL available)"
    fi
    ((HEALTH_ITEMS++)) || true
    
    # Configuration health
    if [ "$CONFIG_OK" = "true" ]; then
        ((HEALTH_ITEMS++)) || true
        ((HEALTH_SCORE++)) || true
        echo "✅ Configuration valid"
    else
        ((HEALTH_ITEMS++)) || true
        echo "❌ Configuration issues detected"
    fi
    
    # Overall health percentage
    echo ""
    HEALTH_PERCENT=$((HEALTH_SCORE * 100 / HEALTH_ITEMS))
    if [ "$HEALTH_PERCENT" -eq 100 ]; then
        echo "Overall Health: ${HEALTH_PERCENT}% (${HEALTH_SCORE}/${HEALTH_ITEMS}) 🎉"
    elif [ "$HEALTH_PERCENT" -gt 75 ]; then
        echo "Overall Health: ${HEALTH_PERCENT}% (${HEALTH_SCORE}/${HEALTH_ITEMS}) ✅"
    elif [ "$HEALTH_PERCENT" -gt 50 ]; then
        echo "Overall Health: ${HEALTH_PERCENT}% (${HEALTH_SCORE}/${HEALTH_ITEMS}) ⚠️"
    else
        echo "Overall Health: ${HEALTH_PERCENT}% (${HEALTH_SCORE}/${HEALTH_ITEMS}) ❌"
    fi
fi
```

## 💡 Helpful Tips Section
```bash
# Show helpful tips based on detected issues
if [ "$BRIEF" != "true" ]; then
    TIPS_SHOWN=false
    
    if [ "$FLOWFORGE_VERSION" = "unknown" ] || [ "$FLOWFORGE_STRUCTURE_OK" = "false" ]; then
        if [ "$TIPS_SHOWN" = "false" ]; then
            echo ""
            echo "💡 Tips:"
            TIPS_SHOWN=true
        fi
        echo "  • Run FlowForge installation: ./scripts/install-flowforge.sh"
        echo "  • Check FlowForge documentation for setup help"
    fi
    
    if [ "$DEPS_OK" -lt 4 ]; then
        if [ "$TIPS_SHOWN" = "false" ]; then
            echo ""
            echo "💡 Tips:"
            TIPS_SHOWN=true
        fi
        echo "  • Install missing dependencies for full functionality"
        echo "  • git and bash are required for core features"
    fi
    
    if ! command -v jq &> /dev/null; then
        if [ "$TIPS_SHOWN" = "false" ]; then
            echo ""
            echo "💡 Tips:"
            TIPS_SHOWN=true
        fi
        echo "  • Install jq for better JSON processing: apt install jq / brew install jq"
    fi
fi

# Debug information
if [[ "${DEBUG:-0}" == "1" ]]; then
    echo ""
    echo "🔍 Debug Info:"
    echo "  Command: /flowforge:system:status"
    echo "  Arguments: ${ARGUMENTS:-none}"
    echo "  Working directory: $(pwd)"
    echo "  User: $(whoami)"
    echo "  Shell: $SHELL"
    echo "  PATH: $PATH"
    echo "  FLOWFORGE_VERSION: $FLOWFORGE_VERSION"
    echo "  DEPS_OK/TOTAL: $DEPS_OK/$DEPS_TOTAL"
fi
```