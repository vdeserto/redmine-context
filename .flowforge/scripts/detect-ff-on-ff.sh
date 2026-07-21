#!/bin/bash
# FlowForge-on-FlowForge Detection Script
# Detects when FlowForge is being used to develop FlowForge itself

set -e

# Source FlowForge context
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "$SCRIPT_DIR/flowforge-context.sh" ]; then
    source "$SCRIPT_DIR/flowforge-context.sh"
fi

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m'

# Detection function
is_flowforge_on_flowforge() {
    # Method 1: Check if .flowforge/config.json has FlowForge as project name
    if [ -f ".flowforge/config.json" ]; then
        local project_name=$(jq -r '.project.name // ""' .flowforge/config.json 2>/dev/null || echo "")
        if [[ "$project_name" == "FlowForge" ]]; then
            return 0
        fi
    fi
    
    # Method 2: Check if current directory contains FlowForge source files
    if [ -f "scripts/install-flowforge.sh" ] && \
       [ -f ".flowforge/VERSION" ] && \
       [ -d "automation/claude-code/commands" ] && \
       [ -f "documentation/README.md" ] && \
       grep -q "FlowForge - AI-Powered Developer Productivity Framework" documentation/README.md 2>/dev/null; then
        return 0
    fi
    
    # Method 3: Check git remote origin
    if git remote get-url origin 2>/dev/null | grep -q "FlowForge"; then
        return 0
    fi
    
    # Method 4: Check for FlowForge signature files
    if [ -f ".flowforge/assets/flowforge-logo.png" ] && \
       [ -f ".flowforge/RULES.md" ] && \
       [ -f "CLAUDE.md" ] && \
       grep -q "FlowForge Development Context" CLAUDE.md 2>/dev/null; then
        return 0
    fi
    
    return 1
}

# Export detection result
export_ff_on_ff_status() {
    if is_flowforge_on_flowforge; then
        export FLOWFORGE_ON_FLOWFORGE="true"
        export FF_ON_FF="true"
        echo "true"
    else
        export FLOWFORGE_ON_FLOWFORGE="false"
        export FF_ON_FF="false"
        echo "false"
    fi
}

# If sourced, make functions available
if [[ "${BASH_SOURCE[0]}" != "${0}" ]]; then
    # Script is being sourced - functions are already available
    true
else
    # Script is being executed
    case "${1:-detect}" in
        detect)
            if is_flowforge_on_flowforge; then
                echo -e "${GREEN}✓ FlowForge-on-FlowForge detected${NC}"
                echo "FF_ON_FF=true"
                exit 0
            else
                echo -e "${BLUE}ℹ️  Regular FlowForge project${NC}"
                echo "FF_ON_FF=false"
                exit 1
            fi
            ;;
        export)
            export_ff_on_ff_status
            ;;
        quiet)
            is_flowforge_on_flowforge
            exit $?
            ;;
        *)
            echo "Usage: $0 [detect|export|quiet]"
            echo "  detect - Show detection result with colors (default)"
            echo "  export - Export environment variables"
            echo "  quiet  - Exit code only (0=FF-on-FF, 1=regular)"
            exit 1
            ;;
    esac
fi