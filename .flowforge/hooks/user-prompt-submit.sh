#!/usr/bin/env bash
# FlowForge User Prompt Submit Hook
# Validates FlowForge rules before Claude executes any action
# This hook is called by Claude Code v1.0.54+ on every user prompt

set -e

# Read JSON input from stdin
INPUT_JSON=$(cat)

# Parse user message from JSON
if command -v jq >/dev/null 2>&1; then
    USER_MESSAGE=$(echo "$INPUT_JSON" | jq -r '.user_message // empty' 2>/dev/null || echo "")
else
    USER_MESSAGE=$(echo "$INPUT_JSON" | sed -n 's/.*"user_message"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
fi

# Function to check critical rules
check_critical_rules() {
    local errors=0
    local warnings=0
    
    # Check if we have an active timer in .flowforge/tasks.json
    if [ -f ".flowforge/tasks.json" ]; then
        # Check for any active task
        if command -v jq >/dev/null 2>&1; then
            local active_task=$(jq -r '.tasks[] | select(.status == "in_progress") | .id' .flowforge/tasks.json 2>/dev/null | head -1)
            local timer_running=$(jq -r '.timer.running // false' .flowforge/tasks.json 2>/dev/null)
        else
            local active_task=""
            local timer_running="false"
        fi
        
        if [[ "$timer_running" != "true" ]]; then
            # Return JSON response to block
            cat <<EOF
{
  "hookSpecificOutput": {
    "hookEventName": "UserPromptSubmit",
    "permissionDecision": "deny",
    "permissionDecisionReason": "TIME = MONEY: No active timer! Run: ./run_ff_command.sh flowforge:session:start [task-id]"
  }
}
EOF
            exit 0
        fi
    else
        # No tasks.json means FlowForge isn't initialized
        cat <<EOF
{
  "hookSpecificOutput": {
    "hookEventName": "UserPromptSubmit",
    "permissionDecision": "deny",
    "permissionDecisionReason": "FlowForge not initialized. Run: ./run_ff_command.sh flowforge:project:setup"
  }
}
EOF
        exit 0
    fi
    
    # Check current branch
    local branch=$(git branch --show-current 2>/dev/null)
    if [[ "$branch" == "main" || "$branch" == "master" || "$branch" == "develop" ]]; then
        cat <<EOF
{
  "hookSpecificOutput": {
    "hookEventName": "UserPromptSubmit",
    "permissionDecision": "deny",
    "permissionDecisionReason": "Rule #18: Cannot work on protected branch '$branch'. Create feature branch first!"
  }
}
EOF
        exit 0
    fi
    
    # Rule 35 Reminder: Check if working on code that needs agents
    if [[ "$USER_MESSAGE" =~ (test|spec|document|frontend|api|database|architect) ]]; then
        # Log reminder but don't block
        echo "$(date) Rule #35 reminder: Use FlowForge agents for: $USER_MESSAGE" >> /tmp/claude-prompt.log
    fi
    
    # All checks passed - allow the action
    exit 0
}

# Main execution
main() {
    # Log the prompt
    echo "$(date) User prompt: ${USER_MESSAGE:0:100}..." >> /tmp/claude-prompt.log
    
    # Only run checks if FlowForge is installed
    if [ ! -f ".flowforge/config.json" ]; then
        exit 0
    fi
    
    # Check critical rules
    check_critical_rules
}

# Run the hook
main "$@"