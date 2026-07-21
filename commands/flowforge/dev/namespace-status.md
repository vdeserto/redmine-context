# /flowforge:dev:namespace-status

Display comprehensive namespace status and information.

## Description

Shows the current developer namespace status including active sessions, workspace usage, and team coordination information. Provides a complete overview of the developer's isolated environment.

## Usage

```bash
/flowforge:dev:namespace-status [--all] [--sessions]
```

## Options

- `--all`: Show status for all configured developers
- `--sessions`: Include detailed session information

## Examples

```bash
# Show current namespace status
/flowforge:dev:namespace-status

# Show all developers' status
/flowforge:dev:namespace-status --all

# Show status with session details
/flowforge:dev:namespace-status --sessions
```

## Implementation

```bash
#!/bin/bash
# FlowForge Developer Namespace Status
# Display comprehensive namespace information
# Issue #548: Developer Namespace Separation

set -euo pipefail

# Configuration
FLOWFORGE_DIR="${FLOWFORGE_ROOT:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}/.flowforge"
PROJECT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
NAMESPACE_SWITCH="$PROJECT_ROOT/scripts/namespace/switch.sh"
NAMESPACE_MANAGER="$PROJECT_ROOT/scripts/namespace/manager.sh"
TEAM_CONFIG="$FLOWFORGE_DIR/team/config.json"

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
RED='\033[0;31m'
MAGENTA='\033[0;35m'
NC='\033[0m'

# Parse arguments
SHOW_ALL=false
SHOW_SESSIONS=false

for arg in ${ARGUMENTS:-}; do
    case "$arg" in
        --all)
            SHOW_ALL=true
            ;;
        --sessions)
            SHOW_SESSIONS=true
            ;;
    esac
done

# Header
echo -e "${CYAN}╔══════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║          FlowForge Namespace Status                 ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════════════════╝${NC}"
echo ""

# Source namespace manager
if [[ -f "$NAMESPACE_MANAGER" ]]; then
    source "$NAMESPACE_MANAGER"
else
    echo -e "${RED}ERROR: Namespace manager not found${NC}"
    exit 1
fi

# Function to format file size
format_size() {
    local size=$1
    if [[ $size -gt 1048576 ]]; then
        echo "$(( size / 1048576 ))MB"
    elif [[ $size -gt 1024 ]]; then
        echo "$(( size / 1024 ))KB"
    else
        echo "${size}B"
    fi
}

# Function to show developer status
show_developer_status() {
    local dev_id="$1"
    local is_current="$2"

    local namespace_dir="$FLOWFORGE_DIR/dev-$dev_id"

    # Developer header
    if [[ "$is_current" == "true" ]]; then
        echo -e "${GREEN}▶ Developer: $dev_id (CURRENT)${NC}"
    else
        echo -e "${BLUE}▶ Developer: $dev_id${NC}"
    fi

    # Get developer info from team config
    if [[ -f "$TEAM_CONFIG" ]]; then
        local dev_info=$(jq -r --arg dev "$dev_id" '.team.developers[$dev] // {}' "$TEAM_CONFIG" 2>/dev/null)
        local dev_name=$(echo "$dev_info" | jq -r '.name // "Unknown"')
        local dev_email=$(echo "$dev_info" | jq -r '.email // "Unknown"')
        local dev_role=$(echo "$dev_info" | jq -r '.role // "Unknown"')

        echo "  Name: $dev_name"
        echo "  Email: $dev_email"
        echo "  Role: $dev_role"
    fi

    # Check if namespace exists
    if [[ ! -d "$namespace_dir" ]]; then
        echo -e "  ${YELLOW}Status: Not initialized${NC}"
        echo ""
        return
    fi

    echo -e "  Status: ${GREEN}Initialized${NC}"

    # Session information
    local session_file="$namespace_dir/sessions/current.json"
    if [[ -f "$session_file" ]]; then
        local session_active=$(jq -r '.active' "$session_file" 2>/dev/null || echo "false")
        local session_id=$(jq -r '.sessionId // "none"' "$session_file" 2>/dev/null || echo "none")
        local task_id=$(jq -r '.taskId // "none"' "$session_file" 2>/dev/null || echo "none")
        local start_time=$(jq -r '.startTime // "none"' "$session_file" 2>/dev/null || echo "none")

        echo ""
        echo "  📊 Session:"
        if [[ "$session_active" == "true" ]]; then
            echo -e "    Status: ${GREEN}ACTIVE${NC}"
            echo "    Task: $task_id"
            echo "    Session ID: $session_id"

            # Calculate elapsed time if active
            if [[ "$start_time" != "none" ]]; then
                local start_epoch=$(date -d "$start_time" +%s 2>/dev/null || echo 0)
                local now_epoch=$(date +%s)
                if [[ $start_epoch -gt 0 ]]; then
                    local elapsed=$((now_epoch - start_epoch))
                    local hours=$((elapsed / 3600))
                    local minutes=$(( (elapsed % 3600) / 60 ))
                    echo "    Duration: ${hours}h ${minutes}m"
                fi
            fi
        else
            echo -e "    Status: ${YELLOW}INACTIVE${NC}"
            if [[ "$task_id" != "none" ]]; then
                echo "    Last Task: $task_id"
            fi
        fi

        # Show detailed session info if requested
        if [[ "$SHOW_SESSIONS" == "true" ]]; then
            echo ""
            echo "  📝 Session History:"
            local history_dir="$namespace_dir/sessions/history"
            if [[ -d "$history_dir" ]]; then
                local session_count=$(find "$history_dir" -name "*.json" 2>/dev/null | wc -l)
                echo "    Total Sessions: $session_count"

                # Show recent sessions
                local recent_sessions=$(find "$history_dir" -name "*.json" -type f -printf "%T@ %p\n" 2>/dev/null | sort -rn | head -3)
                if [[ -n "$recent_sessions" ]]; then
                    echo "    Recent Sessions:"
                    while IFS= read -r session_entry; do
                        local session_path=$(echo "$session_entry" | cut -d' ' -f2)
                        local session_task=$(jq -r '.taskId // "unknown"' "$session_path" 2>/dev/null || echo "unknown")
                        local session_date=$(jq -r '.endTime // .startTime // "unknown"' "$session_path" 2>/dev/null || echo "unknown")
                        echo "      • $session_task ($session_date)"
                    done <<< "$recent_sessions"
                fi
            fi
        fi
    fi

    # Workspace information
    echo ""
    echo "  💾 Storage:"

    # Cache size
    local cache_dir="$namespace_dir/cache"
    if [[ -d "$cache_dir" ]]; then
        local cache_size=$(du -sb "$cache_dir" 2>/dev/null | cut -f1 || echo 0)
        echo "    Cache: $(format_size $cache_size)"
    else
        echo "    Cache: Not created"
    fi

    # Workspace size
    local workspace_dir="$namespace_dir/workspace"
    if [[ -d "$workspace_dir" ]]; then
        local workspace_size=$(du -sb "$workspace_dir" 2>/dev/null | cut -f1 || echo 0)
        echo "    Workspace: $(format_size $workspace_size)"

        # Count temp files
        local temp_count=$(find "$workspace_dir/temp" -type f 2>/dev/null | wc -l)
        if [[ $temp_count -gt 0 ]]; then
            echo -e "    Temp Files: ${YELLOW}$temp_count${NC}"
        fi
    else
        echo "    Workspace: Not created"
    fi

    # Log size
    local log_dir="$namespace_dir/logs"
    if [[ -d "$log_dir" ]]; then
        local log_size=$(du -sb "$log_dir" 2>/dev/null | cut -f1 || echo 0)
        echo "    Logs: $(format_size $log_size)"
    fi

    # Namespace configuration
    local config_file="$namespace_dir/config.json"
    if [[ -f "$config_file" ]]; then
        local created=$(jq -r '.created // "unknown"' "$config_file" 2>/dev/null || echo "unknown")
        echo ""
        echo "  ⚙️  Configuration:"
        echo "    Created: $created"
        echo "    Version: $(jq -r '.version // "unknown"' "$config_file" 2>/dev/null || echo "unknown")"
    fi

    echo ""
}

# Get current developer
CURRENT_DEV=$(get_developer_id)

if [[ "$SHOW_ALL" == "true" ]]; then
    # Show all developers
    if [[ ! -f "$TEAM_CONFIG" ]]; then
        echo -e "${RED}ERROR: Team configuration not found${NC}"
        exit 1
    fi

    echo -e "${MAGENTA}All Configured Developers:${NC}"
    echo ""

    # Get all developers
    local developers=$(jq -r '.team.developers | keys[]' "$TEAM_CONFIG" 2>/dev/null)

    if [[ -z "$developers" ]]; then
        echo -e "${YELLOW}No developers configured${NC}"
    else
        while IFS= read -r dev_id; do
            local is_current="false"
            if [[ "$dev_id" == "$CURRENT_DEV" ]]; then
                is_current="true"
            fi
            show_developer_status "$dev_id" "$is_current"
            echo "────────────────────────────────────────"
            echo ""
        done <<< "$developers"
    fi
else
    # Show current developer only
    if [[ -z "$CURRENT_DEV" ]]; then
        echo -e "${YELLOW}No active developer namespace${NC}"
        echo ""
        echo "To activate a namespace:"
        echo "  1. Initialize: /flowforge:dev:namespace-init [dev_id]"
        echo "  2. Switch: /flowforge:dev:switch <dev_id>"
        echo ""

        # Show available developers
        if [[ -f "$NAMESPACE_SWITCH" ]]; then
            echo "Available developers:"
            "$NAMESPACE_SWITCH" list 2>/dev/null | grep "^  " | head -10 || echo "  No developers configured"
        fi
    else
        show_developer_status "$CURRENT_DEV" "true"
    fi
fi

# Show shared resources status
echo -e "${CYAN}═══════════════════════════════════════════${NC}"
echo -e "${CYAN}Shared Resources:${NC}"

# Active developers
ACTIVE_DEVS_FILE="$FLOWFORGE_DIR/shared/active-developers.json"
if [[ -f "$ACTIVE_DEVS_FILE" ]]; then
    local active_count=$(jq -r '.developers | length' "$ACTIVE_DEVS_FILE" 2>/dev/null || echo 0)
    local active_list=$(jq -r '.developers | join(", ")' "$ACTIVE_DEVS_FILE" 2>/dev/null || echo "none")
    echo "  Active Developers: $active_count"
    if [[ "$active_count" -gt 0 ]]; then
        echo "    $active_list"
    fi
fi

# Task assignments
TASK_ASSIGNMENTS_FILE="$FLOWFORGE_DIR/shared/task-assignments.json"
if [[ -f "$TASK_ASSIGNMENTS_FILE" ]]; then
    local assignment_count=$(jq -r '.assignments | length' "$TASK_ASSIGNMENTS_FILE" 2>/dev/null || echo 0)
    echo "  Task Assignments: $assignment_count"
fi

# Critical locks
LOCKS_DIR="$FLOWFORGE_DIR/locks"
if [[ -d "$LOCKS_DIR" ]]; then
    local lock_count=$(find "$LOCKS_DIR" -name "*.lock" 2>/dev/null | wc -l)
    if [[ $lock_count -gt 0 ]]; then
        echo -e "  ${YELLOW}Active Locks: $lock_count${NC}"
        find "$LOCKS_DIR" -name "*.lock" -printf "    • %f\n" 2>/dev/null | head -5
    fi
fi

echo -e "${CYAN}═══════════════════════════════════════════${NC}"
```

## Features

- **Comprehensive Overview**: Shows all namespace-related information
- **Multi-Developer Support**: Can display all developers' status
- **Session Tracking**: Displays active and historical sessions
- **Storage Metrics**: Shows cache, workspace, and log sizes
- **Team Coordination**: Displays shared resources and locks

## Related Commands

- `/flowforge:dev:namespace-init` - Initialize a new namespace
- `/flowforge:dev:switch` - Switch between namespaces
- `/flowforge:dev:namespace-clean` - Clean namespace files
- `/flowforge:session:start` - Start a development session

## Notes

- Status includes session state, storage usage, and configuration
- `--all` flag shows status for entire team
- `--sessions` flag includes detailed session history
- Shared resources show team coordination state