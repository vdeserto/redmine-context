#!/usr/bin/env bash
# FlowForge PostToolUse Hook - Log Agent Usage
# Works with check-agent-requirement.sh to track agent activation
# Version: 2.0 - Transcript-Based Authentication System

set -e

# Configuration
FLOWFORGE_DIR="${FLOWFORGE_DIR:-$(dirname "$(dirname "$(realpath "$0")")")}"
LOG_FILE="/tmp/claude-posttool.log"
AGENT_AUTH_DIR="$FLOWFORGE_DIR/.agent-auth"
AGENT_LOG="$FLOWFORGE_DIR/logs/agent-usage.log"

# Initialize logging
log_message() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') $1" >> "$LOG_FILE"
}

# Create directories if needed
mkdir -p "$AGENT_AUTH_DIR" "$(dirname "$AGENT_LOG")" 2>/dev/null || true

# Read JSON input from stdin
INPUT_JSON=$(cat)

# Parse JSON to get tool name and details
if command -v jq >/dev/null 2>&1; then
    TOOL_NAME=$(echo "$INPUT_JSON" | jq -r '.tool_name // empty' 2>/dev/null || echo "")
    SESSION_ID=$(echo "$INPUT_JSON" | jq -r '.session_id // empty' 2>/dev/null || echo "")
    TOOL_INPUT=$(echo "$INPUT_JSON" | jq -r '.tool_input // {}' 2>/dev/null || echo "{}")
    TOOL_OUTPUT=$(echo "$INPUT_JSON" | jq -r '.tool_output // empty' 2>/dev/null || echo "")
else
    TOOL_NAME=$(echo "$INPUT_JSON" | sed -n 's/.*"tool_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
    SESSION_ID=$(echo "$INPUT_JSON" | sed -n 's/.*"session_id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
fi

log_message "PostToolUse: Tool=$TOOL_NAME, Session=$SESSION_ID"

# Function to detect agent from Task tool usage
detect_agent_from_task() {
    local input="$1"
    local output="$2"
    local detected_agent=""
    
    # Check input for subagent_type
    if echo "$input" | grep -q "subagent_type"; then
        detected_agent=$(echo "$input" | sed -n 's/.*"subagent_type"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
        log_message "Detected agent from subagent_type: $detected_agent"
    fi
    
    # Check input prompt for "Act as [agent]" pattern
    if [ -z "$detected_agent" ]; then
        local prompt=$(echo "$input" | sed -n 's/.*"prompt"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
        if echo "$prompt" | grep -qi "act as fft-"; then
            detected_agent=$(echo "$prompt" | grep -o 'fft-[a-z-]*' | head -1)
            log_message "Detected agent from prompt: $detected_agent"
        fi
    fi
    
    # Check output for agent headers
    if [ -z "$detected_agent" ] && [ -n "$output" ]; then
        if echo "$output" | grep -q '\[FFT-.*\].*Activated'; then
            detected_agent=$(echo "$output" | grep -o '\[FFT-[^]]*\]' | head -1 | tr '[:upper:]' '[:lower:]' | sed 's/\[//;s/\]//')
            log_message "Detected agent from output header: $detected_agent"
        fi
    fi
    
    echo "$detected_agent"
}

# Function to create agent authentication token
create_agent_auth_token() {
    local agent="$1"
    local session_id="$2"
    
    if [ -n "$agent" ] && [ -n "$session_id" ]; then
        local auth_file="$AGENT_AUTH_DIR/${session_id}_${agent}.auth"
        echo "$(date +%s)" > "$auth_file"
        log_message "Created auth token for $agent in session $session_id"
        
        # Also log to agent usage log
        echo "$(date '+%Y-%m-%d %H:%M:%S')|$session_id|$agent|activated" >> "$AGENT_LOG"
    fi
}

# Function to clean up old auth tokens
cleanup_old_tokens() {
    local session_id="$1"
    local current_time=$(date +%s)
    local timeout=300  # 5 minutes
    
    if [ -d "$AGENT_AUTH_DIR" ]; then
        for auth_file in "$AGENT_AUTH_DIR"/*.auth; do
            [ -f "$auth_file" ] || continue
            
            local token_time=$(stat -c %Y "$auth_file" 2>/dev/null || stat -f %m "$auth_file" 2>/dev/null)
            local age=$((current_time - token_time))
            
            if [ "$age" -gt "$timeout" ]; then
                log_message "Removing expired token: $(basename "$auth_file")"
                rm -f "$auth_file"
            fi
        done
    fi
}

# Main logic
main() {
    # Only process Task tool usage
    if [ "$TOOL_NAME" = "Task" ]; then
        log_message "Processing Task tool usage"
        
        # Detect which agent was invoked
        local detected_agent=$(detect_agent_from_task "$TOOL_INPUT" "$TOOL_OUTPUT")
        
        if [ -n "$detected_agent" ]; then
            log_message "Agent $detected_agent was invoked"
            
            # Create authentication token for this agent
            create_agent_auth_token "$detected_agent" "$SESSION_ID"
            
            # Update session file (backward compatibility)
            if [ -f "$FLOWFORGE_DIR/.current-session" ]; then
                if ! grep -q "agents_used.*$detected_agent" "$FLOWFORGE_DIR/.current-session"; then
                    # Add agent to the list if not already there
                    sed -i.bak '/^agents_used:/d' "$FLOWFORGE_DIR/.current-session"
                    echo "agents_used: $detected_agent" >> "$FLOWFORGE_DIR/.current-session"
                    log_message "Updated .current-session with $detected_agent"
                fi
            fi
        fi
    fi
    
    # Clean up old tokens periodically
    cleanup_old_tokens "$SESSION_ID"
    
    exit 0
}

# Run main logic
main "$@"