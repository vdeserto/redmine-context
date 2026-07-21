#!/bin/bash
# FlowForge v2.0 Git Hooks - Common Functions
# Shared utilities for all v2.0 hooks

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
MAGENTA='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m'

# Get FlowForge directories
get_ff_root() {
    git rev-parse --show-toplevel 2>/dev/null || pwd
}

FF_ROOT="$(get_ff_root)"
FLOWFORGE_DIR="$FF_ROOT/.flowforge"
PROVIDER_BRIDGE="$FF_ROOT/scripts/provider-bridge.js"

# Function to check if node is available
check_node() {
    if ! command -v node &> /dev/null; then
        echo -e "${RED}❌ Node.js is required but not installed${NC}"
        return 1
    fi
    return 0
}

# Function to check if jq is available
check_jq() {
    if ! command -v jq &> /dev/null; then
        echo -e "${YELLOW}⚠️  jq is required for JSON processing${NC}"
        echo -e "${YELLOW}   Install with: sudo apt-get install jq (or brew install jq)${NC}"
        return 1
    fi
    return 0
}

# Function to get current user ID (for user-isolated storage)
get_user_id() {
    local user_id=""
    
    # Try to get from Git config
    user_id=$(git config --get user.email 2>/dev/null | sed 's/@.*//')
    
    # Fallback to system username
    if [ -z "$user_id" ]; then
        user_id=$(whoami)
    fi
    
    echo "$user_id"
}

# Function to get user-specific storage path
get_user_storage_path() {
    local user_id=$(get_user_id)
    echo "$FLOWFORGE_DIR/users/$user_id"
}

# Function to read JSON value safely
read_json_value() {
    local file=$1
    local path=$2
    local default=${3:-""}
    
    if [ ! -f "$file" ]; then
        echo "$default"
        return
    fi
    
    local value=$(jq -r "$path" "$file" 2>/dev/null)
    if [ -z "$value" ] || [ "$value" == "null" ]; then
        echo "$default"
    else
        echo "$value"
    fi
}

# Function to update JSON value safely
update_json_value() {
    local file=$1
    local path=$2
    local value=$3
    
    if [ ! -f "$file" ]; then
        echo "{}" > "$file"
    fi
    
    local temp_file=$(mktemp)
    jq "$path = $value" "$file" > "$temp_file" && mv "$temp_file" "$file"
}

# Function to append to JSON array
append_json_array() {
    local file=$1
    local path=$2
    local value=$3
    
    if [ ! -f "$file" ]; then
        echo "{}" > "$file"
    fi
    
    local temp_file=$(mktemp)
    jq "$path += [$value]" "$file" > "$temp_file" && mv "$temp_file" "$file"
}

# Function to validate JSON file
validate_json_file() {
    local file=$1
    
    if [ ! -f "$file" ]; then
        return 1
    fi
    
    if ! jq empty "$file" 2>/dev/null; then
        return 1
    fi
    
    return 0
}

# Function to get current session info
get_current_session() {
    local session_file="$FLOWFORGE_DIR/sessions/current.json"
    
    if [ ! -f "$session_file" ]; then
        echo "{}"
        return
    fi
    
    cat "$session_file"
}

# Function to get session status
get_session_status() {
    read_json_value "$FLOWFORGE_DIR/sessions/current.json" ".status" "none"
}

# Function to check if timer is running
is_timer_running() {
    local running=$(read_json_value "$FLOWFORGE_DIR/sessions/current.json" ".timer.running" "false")
    [ "$running" == "true" ]
}

# Function to get current task ID
get_current_task() {
    read_json_value "$FLOWFORGE_DIR/sessions/current.json" ".currentTask" ""
}

# Function to get current branch
get_current_branch() {
    git branch --show-current 2>/dev/null || echo "unknown"
}

# Function to check if branch is protected
is_protected_branch() {
    local branch=$1
    local protected_branches=("main" "master" "develop" "production" "staging")
    
    for protected in "${protected_branches[@]}"; do
        if [ "$branch" == "$protected" ]; then
            return 0
        fi
    done
    
    return 1
}

# Function to format timestamp
format_timestamp() {
    date -u +"%Y-%m-%dT%H:%M:%SZ"
}

# Function to calculate duration in seconds
calculate_duration() {
    local start=$1
    local end=$2
    
    local start_seconds=$(date -d "$start" +%s 2>/dev/null || echo 0)
    local end_seconds=$(date -d "$end" +%s 2>/dev/null || echo 0)
    
    echo $((end_seconds - start_seconds))
}

# Function to format duration for display
format_duration() {
    local seconds=$1
    local hours=$((seconds / 3600))
    local minutes=$(((seconds % 3600) / 60))
    local secs=$((seconds % 60))
    
    if [ $hours -gt 0 ]; then
        printf "%dh %dm %ds" $hours $minutes $secs
    elif [ $minutes -gt 0 ]; then
        printf "%dm %ds" $minutes $secs
    else
        printf "%ds" $secs
    fi
}

# Function to check for v1.x legacy files
check_legacy_files() {
    local legacy_files=(
        "$FF_ROOT/.flowforge/tasks.json"
        "$FF_ROOT/.flowforge/sessions/current.json"
        "$FLOWFORGE_DIR/.flowforge/tasks.json"
        "$FLOWFORGE_DIR/.flowforge/sessions/current.json"
    )
    
    local found=0
    for file in "${legacy_files[@]}"; do
        if [ -f "$file" ]; then
            ((found++))
        fi
    done
    
    echo $found
}

# Function to log hook event
log_hook_event() {
    local hook_name=$1
    local event_type=$2
    local details=${3:-""}
    
    local log_file="$FLOWFORGE_DIR/logs/hooks.json"
    mkdir -p "$(dirname "$log_file")"
    
    if [ ! -f "$log_file" ]; then
        echo "[]" > "$log_file"
    fi
    
    local event_json=$(jq -n \
        --arg hook "$hook_name" \
        --arg type "$event_type" \
        --arg details "$details" \
        --arg timestamp "$(format_timestamp)" \
        --arg user "$(get_user_id)" \
        '{hook: $hook, type: $type, details: $details, timestamp: $timestamp, user: $user}')
    
    local temp_file=$(mktemp)
    jq ". += [$event_json]" "$log_file" > "$temp_file" && mv "$temp_file" "$log_file"
}

# Function to call provider bridge
call_provider_bridge() {
    local action=$1
    shift
    local args="$@"
    
    if [ ! -f "$PROVIDER_BRIDGE" ]; then
        echo -e "${YELLOW}⚠️  Provider bridge not found${NC}" >&2
        return 1
    fi
    
    if ! check_node; then
        return 1
    fi
    
    node "$PROVIDER_BRIDGE" "$action" $args 2>/dev/null
}

# Function to verify task exists
verify_task_exists() {
    local task_id=$1
    
    local result=$(call_provider_bridge verify-task --id="$task_id" --format=simple)
    [ "$result" == "true" ]
}

# Function to get task details
get_task_details() {
    local task_id=$1
    
    call_provider_bridge get-task --id="$task_id" --format=json
}

# Function to update task time
update_task_time() {
    local task_id=$1
    local duration=$2
    
    call_provider_bridge update-task --id="$task_id" --add-time="$duration"
}

# Function to send notification (if configured)
send_notification() {
    local title=$1
    local message=$2
    local type=${3:-"info"}  # info, warning, error, success
    
    # Check if notifications are enabled
    local notifications_enabled=$(read_json_value "$FLOWFORGE_DIR/config.json" ".notifications.enabled" "false")
    
    if [ "$notifications_enabled" == "true" ]; then
        # Log to notification queue
        local notification_file="$FLOWFORGE_DIR/notifications.json"
        local notification_json=$(jq -n \
            --arg title "$title" \
            --arg message "$message" \
            --arg type "$type" \
            --arg timestamp "$(format_timestamp)" \
            '{title: $title, message: $message, type: $type, timestamp: $timestamp, read: false}')
        
        if [ ! -f "$notification_file" ]; then
            echo "[]" > "$notification_file"
        fi
        
        local temp_file=$(mktemp)
        jq ". += [$notification_json]" "$notification_file" > "$temp_file" && mv "$temp_file" "$notification_file"
    fi
}

# Export functions for use in other scripts
export -f get_ff_root
export -f check_node
export -f check_jq
export -f get_user_id
export -f get_user_storage_path
export -f read_json_value
export -f update_json_value
export -f append_json_array
export -f validate_json_file
export -f get_current_session
export -f get_session_status
export -f is_timer_running
export -f get_current_task
export -f get_current_branch
export -f is_protected_branch
export -f format_timestamp
export -f calculate_duration
export -f format_duration
export -f check_legacy_files
export -f log_hook_event
export -f call_provider_bridge
export -f verify_task_exists
export -f get_task_details
export -f update_task_time
export -f send_notification