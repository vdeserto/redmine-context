# Command: flowforge:dev:enforcement
# Version: 2.0.0
# Description: FlowForge dev enforcement command

---
description: Check or update FlowForge enforcement level
argument-hint: "[check|gradual|immediate]"
---

# 🚦 FlowForge Enforcement Level Management

Manage how strictly FlowForge rules are enforced in your project.

## 📊 Check Current Status

```bash
# Error handling setup
set -euo pipefail

# Error trap for debugging
error_trap() {
    local exit_code=$?
    echo "❌ Error on line $1, exit code: $exit_code" >&2
    return $exit_code
}
trap 'error_trap ${LINENO}' ERR

# Debug mode
if [[ "${DEBUG:-}" == "1" ]]; then
    set -x
fi

# Help handling
if [[ "${1:-}" == "?" || "${1:-}" == "help" ]]; then
    echo "🚦 FlowForge Enforcement Level Management"
    echo ""
    echo "Manage how strictly FlowForge rules are enforced in your project."
    echo ""
    echo "Usage: /flowforge:dev:enforcement [check|gradual|immediate]"
    echo ""
    echo "Options:"
    echo "  check     - Show current enforcement status (default)"
    echo "  gradual   - Switch to gradual mode (30-day transition)"
    echo "  immediate - Switch to immediate strict mode"
    echo ""
    echo "Examples:"
    echo "  /flowforge:dev:enforcement check"
    echo "  /flowforge:dev:enforcement gradual"
    echo "  /flowforge:dev:enforcement immediate"
    exit 0
fi

# Dependency checks
check_dependencies() {
    local missing_deps=()
    
    if ! command -v jq >/dev/null 2>&1; then
        missing_deps+=("jq")
    fi
    
    if ! command -v date >/dev/null 2>&1; then
        missing_deps+=("date")
    fi
    
    if [[ ${#missing_deps[@]} -gt 0 ]]; then
        echo "❌ Missing required dependencies: ${missing_deps[*]}" >&2
        echo "💡 Please install missing dependencies:" >&2
        for dep in "${missing_deps[@]}"; do
            echo "   - $dep" >&2
        done
        exit 1
    fi
}

# Check configuration file access
check_config_access() {
    local config_file=".flowforge/config.json"
    
    if [[ ! -f "$config_file" ]]; then
        echo "❌ FlowForge not installed in this project" >&2
        echo "💡 Run '/flowforge:project:setup' to initialize FlowForge" >&2
        exit 1
    fi
    
    if [[ ! -r "$config_file" ]]; then
        echo "❌ Cannot read FlowForge configuration file" >&2
        echo "💡 Check file permissions: $config_file" >&2
        exit 1
    fi
}

# Check if config file has valid JSON
validate_config_json() {
    local config_file=".flowforge/config.json"
    
    if ! jq empty "$config_file" >/dev/null 2>&1; then
        echo "❌ FlowForge configuration file contains invalid JSON" >&2
        echo "💡 Please fix the JSON syntax in: $config_file" >&2
        exit 1
    fi
}

# Check write permissions for config updates
check_write_permissions() {
    local config_file=".flowforge/config.json"
    local config_dir=".flowforge"
    
    if [[ ! -w "$config_dir" ]]; then
        echo "❌ Cannot write to FlowForge configuration directory" >&2
        echo "💡 Check directory permissions: $config_dir" >&2
        exit 1
    fi
    
    if [[ -f "$config_file" && ! -w "$config_file" ]]; then
        echo "❌ Cannot write to FlowForge configuration file" >&2
        echo "💡 Check file permissions: $config_file" >&2
        exit 1
    fi
}

# Safe JSON query with error handling
safe_jq_query() {
    local query="$1"
    local config_file=".flowforge/config.json"
    
    if ! result=$(jq -r "$query" "$config_file" 2>/dev/null); then
        echo "❌ Failed to read configuration data" >&2
        echo "💡 Configuration file may be corrupted: $config_file" >&2
        exit 1
    fi
    
    echo "$result"
}

# Safe date calculation with error handling
safe_date_calc() {
    local date_str="$1"
    local format="$2"
    
    if ! result=$(date -d "$date_str" "$format" 2>/dev/null) && ! result=$(date -j -f "%Y-%m-%dT%H:%M:%SZ" "$date_str" "$format" 2>/dev/null); then
        echo "❌ Failed to parse date: $date_str" >&2
        echo "💡 Date format may be invalid" >&2
        return 1
    fi
    
    echo "$result"
}

# Safe config update with atomic write
safe_config_update() {
    local jq_expr="$1"
    local config_file=".flowforge/config.json"
    local temp_file=".flowforge/config.json.tmp"
    
    # Create temporary file with updated config
    if ! jq "$jq_expr" "$config_file" > "$temp_file" 2>/dev/null; then
        echo "❌ Failed to update configuration" >&2
        echo "💡 Configuration update failed, no changes made" >&2
        [[ -f "$temp_file" ]] && rm -f "$temp_file"
        exit 1
    fi
    
    # Validate the new configuration
    if ! jq empty "$temp_file" >/dev/null 2>&1; then
        echo "❌ Configuration update would create invalid JSON" >&2
        echo "💡 Update cancelled, no changes made" >&2
        rm -f "$temp_file"
        exit 1
    fi
    
    # Atomic move
    if ! mv "$temp_file" "$config_file" 2>/dev/null; then
        echo "❌ Failed to save configuration changes" >&2
        echo "💡 Check file permissions and disk space" >&2
        [[ -f "$temp_file" ]] && rm -f "$temp_file"
        exit 1
    fi
}

# Run initial checks
check_dependencies
check_config_access
validate_config_json

# Show current enforcement level and phase
if [[ "${1:-}" == "check" || -z "${1:-}" ]]; then
    echo "🔍 Checking FlowForge enforcement status..."
    
    # Get enforcement info with error handling
    LEVEL=$(safe_jq_query '.enforcement.level // "immediate"')
    START_DATE=$(safe_jq_query '.enforcement.startDate // ""')
    TRANSITION_DATE=$(safe_jq_query '.enforcement.transitionDate // ""')
    
    echo ""
    echo "📋 Current Configuration:"
    echo "   Level: $LEVEL"
    
    if [[ "$LEVEL" == "gradual" && -n "$TRANSITION_DATE" && "$TRANSITION_DATE" != "null" ]]; then
        # Calculate days remaining with error handling
        if CURRENT_DATE=$(date +%s 2>/dev/null) && TRANSITION_TS=$(safe_date_calc "$TRANSITION_DATE" "+%s"); then
            DAYS_LEFT=$(( (TRANSITION_TS - CURRENT_DATE) / 86400 ))
            
            if [[ $DAYS_LEFT -gt 0 ]]; then
                echo "   Phase: Gradual (warnings only)"
                echo "   Days until strict: $DAYS_LEFT"
                echo ""
                echo "⚠️  Rules show warnings but don't block commits"
                if FORMATTED_DATE=$(safe_date_calc "$TRANSITION_DATE" "+%B %d, %Y"); then
                    echo "📅 Strict enforcement begins: $FORMATTED_DATE"
                fi
            else
                echo "   Phase: Strict (transitioned from gradual)"
                echo ""
                echo "✅ Full enforcement now active"
            fi
        else
            echo "   Phase: Gradual (date calculation failed)"
            echo ""
            echo "⚠️  Cannot calculate transition date"
        fi
    else
        echo "   Phase: Immediate (strict)"
        echo ""
        echo "✅ All rules fully enforced"
    fi
    
    exit 0
fi

# 🔄 Switch to Gradual Mode
if [[ "${1:-}" == "gradual" ]]; then
    echo "🔄 Switching to gradual enforcement..."
    
    # Check write permissions before attempting update
    check_write_permissions
    
    # Calculate transition date with error handling
    if ! TRANSITION_DATE=$(date -u -d "+30 days" +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null) && ! TRANSITION_DATE=$(date -u -v +30d +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null); then
        echo "❌ Failed to calculate transition date" >&2
        echo "💡 System date command may not support required options" >&2
        exit 1
    fi
    
    # Update config with error handling
    safe_config_update --arg date "$TRANSITION_DATE" '.enforcement.level = "gradual" | .enforcement.transitionDate = $date | .enforcement.startDate = now | .enforcement.currentPhase = "gradual"'
    
    echo "✅ Switched to gradual enforcement"
    echo "   Warnings for 30 days, then strict"
    if FORMATTED_DATE=$(safe_date_calc "$TRANSITION_DATE" "+%B %d, %Y"); then
        echo "   Transition date: $FORMATTED_DATE"
    fi
    exit 0
fi

# ⚡ Switch to Immediate Mode
if [[ "${1:-}" == "immediate" ]]; then
    echo "⚡ Switching to immediate enforcement..."
    
    # Check write permissions before attempting update
    check_write_permissions
    
    # Update config with error handling
    safe_config_update '.enforcement.level = "immediate" | .enforcement.transitionDate = null | .enforcement.currentPhase = "strict"'
    
    echo "✅ Switched to immediate enforcement"
    echo "   All rules now strictly enforced"
    exit 0
fi

# Invalid argument
echo "❌ Invalid argument: ${1:-}" >&2
echo "" >&2
echo "Usage: /flowforge:dev:enforcement [check|gradual|immediate]" >&2
echo "  check     - Show current enforcement status (default)" >&2
echo "  gradual   - Switch to gradual mode (30-day transition)" >&2
echo "  immediate - Switch to immediate strict mode" >&2
exit 1
```