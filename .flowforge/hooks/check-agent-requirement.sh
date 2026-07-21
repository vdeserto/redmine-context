#!/usr/bin/env bash
# FlowForge PreToolUse Hook - Check Agent Requirements
# Enforces Rule #35: ALWAYS use FlowForge agents when available
# Version: 2.0 - Transcript-Based Authentication System

set -e

# Configuration
FLOWFORGE_DIR="${FLOWFORGE_DIR:-$(dirname "$(dirname "$(realpath "$0")")")}"
LOG_FILE="/tmp/claude-pretool.log"
AGENT_AUTH_DIR="$FLOWFORGE_DIR/.agent-auth"
AGENT_AUTH_TIMEOUT=300  # 5 minutes in seconds

# Initialize logging
log_message() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') $1" >> "$LOG_FILE"
}

# Create agent auth directory if needed
mkdir -p "$AGENT_AUTH_DIR" 2>/dev/null || true

# Read JSON input from stdin
INPUT_JSON=$(cat)

# Parse JSON to get tool name and file path
if command -v jq >/dev/null 2>&1; then
    TOOL_NAME=$(echo "$INPUT_JSON" | jq -r '.tool_name // empty' 2>/dev/null || echo "")
    FILE_PATH=$(echo "$INPUT_JSON" | jq -r '.tool_input.file_path // empty' 2>/dev/null || echo "")
    SESSION_ID=$(echo "$INPUT_JSON" | jq -r '.session_id // empty' 2>/dev/null || echo "")
    TRANSCRIPT_PATH=$(echo "$INPUT_JSON" | jq -r '.transcript_path // empty' 2>/dev/null || echo "")
else
    TOOL_NAME=$(echo "$INPUT_JSON" | sed -n 's/.*"tool_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
    FILE_PATH=$(echo "$INPUT_JSON" | sed -n 's/.*"file_path"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
    SESSION_ID=$(echo "$INPUT_JSON" | sed -n 's/.*"session_id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
    TRANSCRIPT_PATH=$(echo "$INPUT_JSON" | sed -n 's/.*"transcript_path"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
fi

log_message "PreToolUse: Tool=$TOOL_NAME, File=$FILE_PATH, Session=$SESSION_ID"

# Function to detect required agent based on file type/context
detect_required_agent() {
    local file="$1"
    local required_agent=""
    
    # PRIORITY 1: Command files are NOT documentation, can be written by any agent
    # Check this FIRST before other patterns match
    if [[ "$file" == */commands/* ]] || [[ "$file" == /commands/* ]]; then
        # Command files contain executable bash in MD format
        # They should be writable by backend/devops/any appropriate agent
        log_message "Command file detected: $file - no specific agent required"
        required_agent=""
        echo "$required_agent"
        return
    fi
    
    # Testing files (Rule #3 - TDD mandatory)
    # Allow any coder agent OR fft-testing to write tests for better flow
    if [[ "$file" == *.test.* ]] || [[ "$file" == *.spec.* ]] || 
       [[ "$file" == */tests/* ]] || [[ "$file" == */__tests__/* ]] ||
       [[ "$file" == */test/* ]] || [[ "$file" == *.test.ts ]] ||
       [[ "$file" == *.test.js ]] || [[ "$file" == *.spec.ts ]] ||
       [[ "$file" == *.spec.js ]]; then
        # Check if a coder agent is already active in the transcript
        # If so, they can write their own tests. Otherwise require fft-testing
        local coder_agents=("fft-backend" "fft-frontend" "fft-api-designer" "fft-database")
        local coder_active=false
        for agent in "${coder_agents[@]}"; do
            if check_agent_active_in_transcript "$agent" "$TRANSCRIPT_PATH" || 
               check_agent_auth_token "$agent" "$SESSION_ID"; then
                log_message "Allowing $agent to write tests for TDD flow"
                coder_active=true
                break
            fi
        done
        # If a coder agent is active, no specific agent required for tests
        if [ "$coder_active" = false ]; then
            # If no coder agent is active, require fft-testing
            required_agent="fft-testing"
        fi
    # Documentation files
    elif [[ "$file" == *.md ]] || [[ "$file" == */docs/* ]] || 
         [[ "$file" == */documentation/* ]] || [[ "$file" == README* ]] ||
         [[ "$file" == */README* ]]; then
        required_agent="fft-documentation"
    # Frontend files
    elif [[ "$file" == *.tsx ]] || [[ "$file" == *.jsx ]] || 
         [[ "$file" == *.vue ]] || [[ "$file" == */components/* ]] ||
         [[ "$file" == */pages/* ]] || [[ "$file" == */views/* ]] ||
         [[ "$file" == *.css ]] || [[ "$file" == *.scss ]] ||
         [[ "$file" == */styles/* ]]; then
        required_agent="fft-frontend"
    # Backend files
    elif [[ "$file" == */controllers/* ]] || [[ "$file" == */models/* ]] ||
         [[ "$file" == */services/* ]] || [[ "$file" == */routes/* ]] ||
         [[ "$file" == */middleware/* ]] || [[ "$file" == *.py ]] ||
         [[ "$file" == *.rb ]] || [[ "$file" == *.go ]] ||
         [[ "$file" == *.java ]] || [[ "$file" == */server/* ]] ||
         [[ "$file" == */src/*.ts ]] || [[ "$file" == */src/*.js ]] ||
         [[ "$file" == */backend/* ]] || [[ "$file" == */lib/* ]]; then
        required_agent="fft-backend"
    # API files
    elif [[ "$file" == */api/* ]] || [[ "$file" == *.graphql ]] ||
         [[ "$file" == */graphql/* ]] || [[ "$file" == */rest/* ]] ||
         [[ "$file" == */endpoints/* ]] || [[ "$file" == *.proto ]] ||
         [[ "$file" == */openapi/* ]] || [[ "$file" == */swagger/* ]]; then
        required_agent="fft-api-designer"
    # Database files
    elif [[ "$file" == */database/* ]] || [[ "$file" == */db/* ]] ||
         [[ "$file" == */migrations/* ]] || [[ "$file" == */schema/* ]] ||
         [[ "$file" == *.sql ]] || [[ "$file" == */queries/* ]] ||
         [[ "$file" == */seeds/* ]]; then
        required_agent="fft-database"
    # DevOps files
    elif [[ "$file" == *.yml ]] || [[ "$file" == *.yaml ]] ||
         [[ "$file" == Dockerfile* ]] || [[ "$file" == */docker/* ]] ||
         [[ "$file" == *.tf ]] || [[ "$file" == */terraform/* ]] ||
         [[ "$file" == */kubernetes/* ]] || [[ "$file" == */k8s/* ]] ||
         [[ "$file" == */.github/workflows/* ]] || [[ "$file" == */ci/* ]] ||
         [[ "$file" == */cd/* ]] || [[ "$file" == Jenkinsfile ]] ||
         [[ "$file" == */.flowforge/hooks/* ]]; then
        required_agent="fft-devops-agent"
    # Architecture files
    elif [[ "$file" == */architecture/* ]] || [[ "$file" == */design/* ]] ||
         [[ "$file" == *.puml ]] || [[ "$file" == */diagrams/* ]]; then
        required_agent="fft-architecture"
    # Security files
    elif [[ "$file" == */security/* ]] || [[ "$file" == *.pem ]] ||
         [[ "$file" == *.key ]] || [[ "$file" == */auth/* ]] ||
         [[ "$file" == */oauth/* ]] || [[ "$file" == */jwt/* ]]; then
        required_agent="fft-security"
    # Performance files
    elif [[ "$file" == */performance/* ]] || [[ "$file" == */benchmarks/* ]] ||
         [[ "$file" == */profiling/* ]] || [[ "$file" == */metrics/* ]]; then
        required_agent="fft-performance"
    # Agent files
    elif [[ "$file" == */agents/* ]] || [[ "$file" == *.agent.yml ]] ||
         [[ "$file" == *.agent.yaml ]]; then
        required_agent="fft-agent-creator"
    # Project management files
    elif [[ "$file" == */project/* ]] || [[ "$file" == .flowforge/tasks.json ]] ||
         [[ "$file" == SCHEDULE.md ]] || [[ "$file" == */issues/* ]]; then
        required_agent="fft-project-manager"
    fi
    
    echo "$required_agent"
}

# Function to check if agent is currently active via transcript
check_agent_active_in_transcript() {
    local required_agent="$1"
    local transcript="$2"
    
    # If no transcript path, we can't verify
    if [ -z "$transcript" ] || [ ! -f "$transcript" ]; then
        log_message "No transcript available for verification"
        return 1
    fi
    
    # Check last 100 lines of transcript for recent agent activation
    # Look for patterns indicating Task tool usage with specific agent
    local recent_lines=$(tail -100 "$transcript" 2>/dev/null || echo "")
    
    # Pattern 1: Task tool invocation with subagent_type
    if echo "$recent_lines" | grep -q "subagent_type.*$required_agent"; then
        log_message "Agent $required_agent detected via subagent_type in transcript"
        return 0
    fi
    
    # Pattern 2: "Act as [agent]" pattern
    if echo "$recent_lines" | grep -q "Act as $required_agent"; then
        log_message "Agent $required_agent detected via 'Act as' pattern in transcript"
        return 0
    fi
    
    # Pattern 3: Agent header in output
    if echo "$recent_lines" | grep -q "\[FFT-.*\].*Activated"; then
        # Extract the specific agent from the header
        local active_agent=$(echo "$recent_lines" | grep -o '\[FFT-[^]]*\]' | tail -1 | tr '[:upper:]' '[:lower:]' | sed 's/\[//;s/\]//')
        if [ "$active_agent" = "$required_agent" ]; then
            log_message "Agent $required_agent confirmed active via header"
            return 0
        fi
    fi
    
    return 1
}

# Function to check if ANY agent is active (for allowing agents to write MD files)
check_any_agent_active() {
    local transcript="$1"
    local session_id="$2"
    
    # Check transcript for any agent activation
    if [ -n "$transcript" ] && [ -f "$transcript" ]; then
        local recent_lines=$(tail -100 "$transcript" 2>/dev/null || echo "")
        
        # Check for any FFT agent header
        if echo "$recent_lines" | grep -q "\[FFT-.*\].*Activated"; then
            log_message "An FFT agent is currently active"
            return 0
        fi
        
        # Check for Task tool usage
        if echo "$recent_lines" | grep -q "subagent_type.*fft-"; then
            log_message "FFT agent detected via Task tool"
            return 0
        fi
    fi
    
    # Check for any auth tokens in this session
    if [ -n "$session_id" ] && [ -d "$AGENT_AUTH_DIR" ]; then
        for auth_file in "$AGENT_AUTH_DIR/${session_id}_"*.auth; do
            if [ -f "$auth_file" ]; then
                local token_time=$(stat -c %Y "$auth_file" 2>/dev/null || stat -f %m "$auth_file" 2>/dev/null)
                local current_time=$(date +%s)
                local age=$((current_time - token_time))
                
                if [ "$age" -lt "$AGENT_AUTH_TIMEOUT" ]; then
                    log_message "Valid agent auth token found"
                    return 0
                fi
            fi
        done
    fi
    
    return 1
}

# Function to check for valid agent authentication token
check_agent_auth_token() {
    local required_agent="$1"
    local session_id="$2"
    
    # Look for authentication token file
    local auth_file="$AGENT_AUTH_DIR/${session_id}_${required_agent}.auth"
    
    if [ -f "$auth_file" ]; then
        # Check if token is still valid (not expired)
        local token_time=$(stat -c %Y "$auth_file" 2>/dev/null || stat -f %m "$auth_file" 2>/dev/null)
        local current_time=$(date +%s)
        local age=$((current_time - token_time))
        
        if [ "$age" -lt "$AGENT_AUTH_TIMEOUT" ]; then
            log_message "Valid auth token found for $required_agent (age: ${age}s)"
            return 0
        else
            log_message "Auth token expired for $required_agent (age: ${age}s)"
            rm -f "$auth_file"  # Clean up expired token
        fi
    fi
    
    return 1
}

# Function to create agent authentication token (called by PostToolUse hook)
create_agent_auth_token() {
    local agent="$1"
    local session_id="$2"
    
    if [ -n "$agent" ] && [ -n "$session_id" ]; then
        local auth_file="$AGENT_AUTH_DIR/${session_id}_${agent}.auth"
        echo "$(date +%s)" > "$auth_file"
        log_message "Created auth token for $agent in session $session_id"
    fi
}

# Main enforcement logic
main() {
    # Skip if not a file modification tool
    if [[ "$TOOL_NAME" != "Write" && "$TOOL_NAME" != "Edit" && "$TOOL_NAME" != "MultiEdit" ]]; then
        exit 0
    fi
    
    # Skip if no file path
    if [ -z "$FILE_PATH" ]; then
        exit 0
    fi
    
    # Detect required agent for this file
    local required_agent=$(detect_required_agent "$FILE_PATH")
    
    # If no specific agent is required, allow the operation
    if [ -z "$required_agent" ]; then
        log_message "No specific agent required for $FILE_PATH"
        exit 0
    fi
    
    log_message "File $FILE_PATH requires agent: $required_agent"
    
    # Special case for MD files: If ANY agent is active, allow them to write MD files
    # This allows backend/devops agents to create command files, etc.
    if [[ "$FILE_PATH" == *.md ]] && [ "$required_agent" = "fft-documentation" ]; then
        if check_any_agent_active "$TRANSCRIPT_PATH" "$SESSION_ID"; then
            log_message "ALLOWED: Active agent can write MD file $FILE_PATH"
            exit 0
        fi
    fi
    
    # Check 1: Authentication token (fastest check)
    if check_agent_auth_token "$required_agent" "$SESSION_ID"; then
        log_message "ALLOWED: Valid auth token for $required_agent"
        exit 0
    fi
    
    # Check 2: Transcript analysis (most reliable)
    if check_agent_active_in_transcript "$required_agent" "$TRANSCRIPT_PATH"; then
        log_message "ALLOWED: Agent $required_agent active in transcript"
        # Create auth token for faster future checks
        create_agent_auth_token "$required_agent" "$SESSION_ID"
        exit 0
    fi
    
    # Check 3: Environment variable (fallback for manual override)
    if [ -n "${FLOWFORGE_AGENT_OVERRIDE:-}" ] && [ "$FLOWFORGE_AGENT_OVERRIDE" = "$required_agent" ]; then
        log_message "ALLOWED: Manual override for $required_agent"
        exit 0
    fi
    
    # Special case: Allow modifications to hook files if we're fixing the system
    if [[ "$FILE_PATH" == */.flowforge/hooks/* ]] && [ -n "${FLOWFORGE_FIXING_HOOKS:-}" ]; then
        log_message "ALLOWED: Hook system maintenance mode"
        exit 0
    fi
    
    # Agent is required but not authenticated - block the operation
    log_message "BLOCKED: $FILE_PATH requires $required_agent agent (not authenticated)"
    
    # Output JSON response to deny permission
    cat <<EOF
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "Rule #35: File $FILE_PATH requires $required_agent agent. Use Task tool with subagent_type: '$required_agent' or prompt: 'Act as $required_agent specialist'"
  }
}
EOF
    # Exit with code 0 when returning JSON (per Claude Code docs)
    exit 0
}

# Handle special commands (for testing and maintenance)
if [ "$1" = "create-token" ] && [ -n "$2" ] && [ -n "$3" ]; then
    create_agent_auth_token "$2" "$3"
    exit 0
fi

# Run main enforcement logic
main "$@"