# Command: flowforge:dev:validate
# Version: 2.0.0
# Description: FlowForge dev validate command

---
description: Validate FlowForge installation and configuration
---

# ✅ FlowForge Installation Validator

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
    if [[ "${BASH_COMMAND:-}" =~ ".flowforge" ]]; then
        echo "💡 FlowForge directory or file not found"
        echo "   Ensure FlowForge is properly installed"
    elif [[ "${BASH_COMMAND:-}" =~ "git" ]]; then
        echo "💡 Git command failed - ensure you're in a git repository"
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
✅ FlowForge Installation Validator

Validates FlowForge installation and project configuration.

Usage: /flowforge:dev:validate [options]

Options:
  (none)         Run standard validation
  --verbose      Show detailed validation output
  help, ?        Show this help message

Checks performed:
  • FlowForge directory structure
  • Required files and scripts
  • Git configuration
  • Hook installation
  • Basic environment setup

Examples:
  /flowforge:dev:validate           # Standard validation
  /flowforge:dev:validate --verbose # Detailed validation
  /flowforge:dev:validate help      # Show this help
EOF
    exit 0
fi
```

## 🔍 Parse Options
```bash
# Initialize options
VERBOSE=false
VALIDATION_ERRORS=0
VALIDATION_WARNINGS=0
VALIDATION_PASSES=0

# Parse arguments
for arg in ${ARGUMENTS:-}; do
    case "$arg" in
        --verbose) VERBOSE=true ;;
        --*) echo "⚠️  Unknown option: $arg" ;;
    esac
done
```

## ✅ Core Validation Functions
```bash
# Function to check if file exists
check_file() {
    local file="$1"
    local description="$2"
    local required="${3:-true}"
    
    if [ -f "$file" ]; then
        echo "  ✅ $description"
        ((VALIDATION_PASSES++)) || true
        [ "$VERBOSE" = "true" ] && echo "     Found: $file"
        return 0
    else
        if [ "$required" = "true" ]; then
            echo "  ❌ $description"
            ((VALIDATION_ERRORS++)) || true
        else
            echo "  ⚠️  $description (optional)"
            ((VALIDATION_WARNINGS++)) || true
        fi
        [ "$VERBOSE" = "true" ] && echo "     Missing: $file"
        return 1
    fi
}

# Function to check if directory exists
check_directory() {
    local dir="$1"
    local description="$2"
    local required="${3:-true}"
    
    if [ -d "$dir" ]; then
        echo "  ✅ $description"
        ((VALIDATION_PASSES++)) || true
        [ "$VERBOSE" = "true" ] && echo "     Found: $dir"
        return 0
    else
        if [ "$required" = "true" ]; then
            echo "  ❌ $description"
            ((VALIDATION_ERRORS++)) || true
        else
            echo "  ⚠️  $description (optional)"
            ((VALIDATION_WARNINGS++)) || true
        fi
        [ "$VERBOSE" = "true" ] && echo "     Missing: $dir"
        return 1
    fi
}

# Function to check executable
check_executable() {
    local file="$1"
    local description="$2"
    
    if [ -x "$file" ]; then
        echo "  ✅ $description is executable"
        ((VALIDATION_PASSES++)) || true
        return 0
    elif [ -f "$file" ]; then
        echo "  ⚠️  $description exists but not executable"
        ((VALIDATION_WARNINGS++)) || true
        [ "$VERBOSE" = "true" ] && echo "     Run: chmod +x $file"
        return 1
    else
        echo "  ❌ $description not found"
        ((VALIDATION_ERRORS++)) || true
        return 1
    fi
}
```

## 🏗️ Main Validation
```bash
# Header
echo "✅ FlowForge Installation Validator"
echo "==================================="
echo ""

# 1. Check FlowForge directory structure
echo "📁 FlowForge Directory Structure"
echo "--------------------------------"
check_directory ".flowforge" "FlowForge configuration directory"
check_directory ".flowforge/hooks" "Hooks directory" false
check_directory ".flowforge/scripts" "Scripts directory" false
check_directory ".flowforge/templates" "Templates directory" false
echo ""

# 2. Check essential files
echo "📄 Essential Files"
echo "------------------"
check_file ".flowforge/RULES.md" "FlowForge rules documentation" false
check_file ".flowforge/config.json" "FlowForge configuration" false
check_file ".flowforge-version.json" "Version information" false
echo ""

# 3. Check command structure
echo "📚 Command Structure"
echo "--------------------"
check_directory "commands" "Commands directory"
check_directory "commands/flowforge" "FlowForge commands"
check_directory "commands/flowforge/session" "Session commands" false
check_directory "commands/flowforge/dev" "Development commands" false
check_directory "commands/flowforge/project" "Project commands" false
echo ""

# 4. Check scripts
echo "🔧 Scripts"
echo "----------"
if [ -d "scripts" ]; then
    check_executable "scripts/task-time.sh" "Time tracking script"
    check_executable "scripts/install-flowforge.sh" "Installation script"
    check_file "scripts/run_ff_command.sh" "Command runner" false
else
    echo "  ⚠️  Scripts directory not found"
    ((VALIDATION_WARNINGS++)) || true
fi
echo ""

# 5. Check Git configuration
echo "🌿 Git Configuration"
echo "--------------------"
if command -v git &> /dev/null && git rev-parse --git-dir &> /dev/null 2>&1; then
    echo "  ✅ Git repository detected"
    ((VALIDATION_PASSES++)) || true
    
    # Check if hooks are installed
    GIT_DIR=$(git rev-parse --git-dir)
    if [ -d "$GIT_DIR/hooks" ]; then
        if ls "$GIT_DIR/hooks/"*flowforge* &> /dev/null 2>&1; then
            echo "  ✅ FlowForge hooks installed"
            ((VALIDATION_PASSES++)) || true
        else
            echo "  ⚠️  FlowForge hooks not installed"
            ((VALIDATION_WARNINGS++)) || true
            [ "$VERBOSE" = "true" ] && echo "     Run: ./scripts/install-flowforge.sh"
        fi
    fi
else
    echo "  ⚠️  Not in a git repository"
    ((VALIDATION_WARNINGS++)) || true
fi
echo ""

# 6. Check environment
echo "🌍 Environment"
echo "--------------"

# Check Node.js
if command -v node &> /dev/null; then
    NODE_VERSION=$(node --version)
    echo "  ✅ Node.js installed: $NODE_VERSION"
    ((VALIDATION_PASSES++)) || true
else
    echo "  ⚠️  Node.js not found (optional)"
    ((VALIDATION_WARNINGS++)) || true
fi

# Check npm
if command -v npm &> /dev/null; then
    NPM_VERSION=$(npm --version)
    echo "  ✅ npm installed: $NPM_VERSION"
    ((VALIDATION_PASSES++)) || true
else
    echo "  ⚠️  npm not found (optional)"
    ((VALIDATION_WARNINGS++)) || true
fi

# Check jq (often used in FlowForge scripts)
if command -v jq &> /dev/null; then
    echo "  ✅ jq installed"
    ((VALIDATION_PASSES++)) || true
else
    echo "  ⚠️  jq not found (recommended)"
    ((VALIDATION_WARNINGS++)) || true
fi
```

## 📊 Validation Summary
```bash
# Calculate totals
TOTAL_CHECKS=$((VALIDATION_PASSES + VALIDATION_ERRORS + VALIDATION_WARNINGS))

# Display summary
echo ""
echo "📊 Validation Summary"
echo "===================="
echo "Total checks: $TOTAL_CHECKS"
echo "  ✅ Passed: $VALIDATION_PASSES"
echo "  ⚠️  Warnings: $VALIDATION_WARNINGS"
echo "  ❌ Errors: $VALIDATION_ERRORS"

# Determine overall status
echo ""
if [ $VALIDATION_ERRORS -eq 0 ]; then
    if [ $VALIDATION_WARNINGS -eq 0 ]; then
        echo "🎉 FlowForge installation is fully valid!"
        exit 0
    else
        echo "✅ FlowForge installation is valid with $VALIDATION_WARNINGS warnings"
        echo ""
        echo "💡 Tips to resolve warnings:"
        echo "  • Install optional dependencies"
        echo "  • Run ./scripts/install-flowforge.sh for complete setup"
        echo "  • Check documentation for configuration options"
        exit 0
    fi
else
    echo "❌ FlowForge installation has $VALIDATION_ERRORS errors"
    echo ""
    echo "💡 To fix errors:"
    echo "  • Ensure you're in a FlowForge project root"
    echo "  • Run ./scripts/install-flowforge.sh to set up FlowForge"
    echo "  • Check that all required files are present"
    exit 1
fi
```

## 🔧 Additional Helpers
```bash
# Show verbose information if requested
if [ "$VERBOSE" = "true" ]; then
    echo ""
    echo "🔍 Verbose Information"
    echo "====================="
    echo "Working directory: $(pwd)"
    echo "User: $(whoami)"
    echo "Shell: $SHELL"
    echo "PATH entries:"
    echo "$PATH" | tr ':' '\n' | head -5 | sed 's/^/  /'
    echo "  ..."
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