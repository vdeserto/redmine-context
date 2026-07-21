# Command: flowforge:dev:status
# Version: 2.0.0
# Description: FlowForge dev status command

---
description: Show project status and health
---

# 📊 FlowForge Project Status

## 🔧 Setup Error Handling
```bash
# Enable strict error handling
set -euo pipefail

# Error handler function
handle_error() {
    local exit_code=$?
    local line_number=$1
    echo "❌ Error on line $line_number (exit code: $exit_code)"
    
    # Provide helpful error messages based on context
    if [[ "${BASH_COMMAND:-}" =~ "git" ]]; then
        echo "💡 Git command failed - ensure you're in a git repository"
    elif [[ "${BASH_COMMAND:-}" =~ "npm" ]]; then
        echo "💡 npm command failed - check if package.json exists"
    elif [[ "${BASH_COMMAND:-}" =~ "task-time" ]]; then
        echo "💡 Time tracking script not found or failed"
    fi
    
    exit $exit_code
}

# Set error trap
trap 'handle_error $LINENO' ERR

# Enable debug mode if DEBUG=1
[[ "${DEBUG:-0}" == "1" ]] && set -x
```

## 📚 Show Help
```bash
# Check if help is requested
if [[ "${ARGUMENTS:-}" == "?" || "${ARGUMENTS:-}" == "help" ]]; then
    cat << 'EOF'
📊 FlowForge Status

Comprehensive project status overview including git, tests, and time tracking.

Usage: /flowforge:dev:status [options]

Options:
  (none)         Show standard status overview
  --verbose      Show detailed status information
  --brief        Show only essential status
  help, ?        Show this help message

Sections shown:
  • Git status (branch, changes)
  • Test status (if available)
  • Time tracking (active tasks)
  • Project health indicators

Examples:
  /flowforge:dev:status              # Standard overview
  /flowforge:dev:status --verbose    # Detailed information
  /flowforge:dev:status --brief      # Quick summary
EOF
    exit 0
fi
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
        --*) echo "⚠️  Unknown option: $arg" ;;
    esac
done
```

## 📊 Main Status Display
```bash
# Header
echo "📊 FlowForge Project Status"
echo "=========================="
echo ""

# Git status section
echo "🌿 Git Status"
echo "-------------"

# Check if we're in a git repository
if command -v git &> /dev/null && git rev-parse --git-dir &> /dev/null 2>&1; then
    CURRENT_BRANCH=$(git branch --show-current 2>/dev/null || echo "unknown")
    echo "Branch: $CURRENT_BRANCH"
    
    # Check for uncommitted changes
    CHANGES=$(git status --porcelain | wc -l)
    if [ "$CHANGES" -eq 0 ]; then
        echo "Status: ✅ Clean working directory"
    else
        echo "Status: 📝 $CHANGES uncommitted changes"
        if [ "$BRIEF" != "true" ]; then
            echo ""
            git status --short
        fi
    fi
    
    # Show last commit in verbose mode
    if [ "$VERBOSE" = "true" ]; then
        echo ""
        echo "Last commit:"
        git log -1 --format="  %h %s (%cr)" 2>/dev/null || echo "  No commits yet"
    fi
else
    echo "❌ Not in a git repository"
fi

# Test status section
echo ""
echo "🧪 Test Status"
echo "--------------"

# Check for npm/package.json
if [ -f "package.json" ] && command -v npm &> /dev/null; then
    # Check if test script exists
    if grep -q '"test"' package.json 2>/dev/null; then
        echo "Running tests..."
        
        # Run tests but don't fail the whole command if tests fail
        if npm test 2>&1 | tail -5; then
            echo "Status: ✅ Tests passed"
        else
            echo "Status: ❌ Tests failed"
        fi
    else
        echo "ℹ️  No test script defined in package.json"
    fi
elif [ -f "Makefile" ] && grep -q "^test:" Makefile 2>/dev/null; then
    echo "Running make tests..."
    if make test 2>&1 | tail -5; then
        echo "Status: ✅ Tests passed"
    else
        echo "Status: ❌ Tests failed"
    fi
else
    echo "ℹ️  No test configuration found"
fi

# Time tracking section
echo ""
echo "⏱️  Time Tracking"
echo "----------------"

# Look for task-time script in multiple locations
TASK_TIME_SCRIPT=""
if [ -f "./scripts/task-time.sh" ]; then
    TASK_TIME_SCRIPT="./scripts/task-time.sh"
elif [ -f "./.flowforge/scripts/task-time.sh" ]; then
    TASK_TIME_SCRIPT="./.flowforge/scripts/task-time.sh"
fi

if [ -n "$TASK_TIME_SCRIPT" ] && [ -x "$TASK_TIME_SCRIPT" ]; then
    # Run task time status but handle errors gracefully
    if $TASK_TIME_SCRIPT status 2>&1; then
        :  # Success, output already shown
    else
        echo "⚠️  Time tracking error (script failed)"
    fi
else
    echo "ℹ️  Time tracking not available"
    [ "$VERBOSE" = "true" ] && echo "   (task-time.sh script not found)"
fi

# Additional verbose information
if [ "$VERBOSE" = "true" ]; then
    echo ""
    echo "🔍 Environment"
    echo "--------------"
    echo "Working directory: $(pwd)"
    echo "User: $(whoami)"
    echo "Node version: $(node --version 2>/dev/null || echo "Not installed")"
    echo "npm version: $(npm --version 2>/dev/null || echo "Not installed")"
    
    # FlowForge version if available
    if [ -f ".flowforge-version.json" ]; then
        echo "FlowForge version: $(jq -r '.version // "unknown"' .flowforge-version.json 2>/dev/null || echo "Error reading version")"
    fi
fi

# Project health summary
if [ "$BRIEF" != "true" ]; then
    echo ""
    echo "📈 Summary"
    echo "---------"
    
    # Collect health indicators
    HEALTH_SCORE=0
    HEALTH_ITEMS=0
    
    # Git health
    if [ "${CURRENT_BRANCH:-}" != "unknown" ] && [ "${CURRENT_BRANCH:-}" != "" ]; then
        ((HEALTH_SCORE++)) || true
        echo "✅ Git repository configured"
    else
        echo "❌ Not in git repository"
    fi
    ((HEALTH_ITEMS++)) || true
    
    # Clean working directory
    if [ "${CHANGES:-1}" -eq 0 ]; then
        ((HEALTH_SCORE++)) || true
        echo "✅ Clean working directory"
    else
        echo "⚠️  Uncommitted changes present"
    fi
    ((HEALTH_ITEMS++)) || true
    
    # Tests configured
    if [ -f "package.json" ] && grep -q '"test"' package.json 2>/dev/null; then
        ((HEALTH_SCORE++)) || true
        echo "✅ Tests configured"
    else
        echo "⚠️  No tests configured"
    fi
    ((HEALTH_ITEMS++)) || true
    
    # Time tracking available
    if [ -n "$TASK_TIME_SCRIPT" ]; then
        ((HEALTH_SCORE++)) || true
        echo "✅ Time tracking available"
    else
        echo "ℹ️  Time tracking not configured"
    fi
    ((HEALTH_ITEMS++)) || true
    
    # Overall health
    echo ""
    HEALTH_PERCENT=$((HEALTH_SCORE * 100 / HEALTH_ITEMS))
    echo "Overall Health: $HEALTH_PERCENT% ($HEALTH_SCORE/$HEALTH_ITEMS)"
fi
```

## 🔧 Additional Helpers
```bash
# Show quick tips if issues detected
if [ "${CHANGES:-0}" -gt 0 ] && [ "$BRIEF" != "true" ]; then
    echo ""
    echo "💡 Tips:"
    echo "  • Review changes: git diff"
    echo "  • Stage changes: git add -A"
    echo "  • Commit: git commit -m 'message'"
fi

# Debug info
if [[ "${DEBUG:-0}" == "1" ]]; then
    echo ""
    echo "🔍 Debug Info:"
    echo "  Script: $0"
    echo "  Arguments: ${ARGUMENTS:-none}"
    echo "  PWD: $(pwd)"
fi
```
