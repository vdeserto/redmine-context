#!/bin/bash
# FlowForge Context Detection System
# Detects if we're in source repo or installed in a host project
# This is THE single source of truth for all path resolution

# Function to detect FlowForge root directory
detect_flowforge_root() {
    # Method 1: Check if we're in FlowForge source repository
    if [ -f "VERSION" ] && [ -f "RULES.md" ] && [ -d "hooks" ] && [ -d "scripts" ] && [ -f "scripts/install-flowforge.sh" ]; then
        echo "."
        return 0
    fi
    
    # Method 2: Check if we're in a host project with FlowForge installed
    if [ -f ".flowforge/VERSION" ] && [ -f ".flowforge/RULES.md" ] && [ -d ".flowforge/hooks" ]; then
        echo ".flowforge"
        return 0
    fi
    
    # Method 3: Check relative to script location (for sourced scripts)
    local script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    if [ -f "$script_dir/../VERSION" ] && [ -f "$script_dir/../RULES.md" ]; then
        echo "$script_dir/.."
        return 0
    fi
    
    # Not found
    echo ""
    return 1
}

# Export FlowForge root and context variables
export FF_ROOT=$(detect_flowforge_root)
export FF_IS_SOURCE=$([[ "$FF_ROOT" == "." ]] && echo "true" || echo "false")
export FF_IS_INSTALLED=$([[ "$FF_ROOT" == ".flowforge" ]] && echo "true" || echo "false")

# Validate detection
if [ -z "$FF_ROOT" ]; then
    echo "Error: Unable to detect FlowForge installation" >&2
    echo "Please run from a FlowForge project directory" >&2
    exit 1
fi

# Helper function to get correct path
ff_path() {
    local path="$1"
    echo "$FF_ROOT/$path"
}

# Helper functions are available when sourced
# (bash functions are automatically available in sourced scripts)