#!/bin/bash

# FlowForge Task Time Tracker with Auto-Documentation
# Handles start, pause, unpause, and stop with automatic time calculation
# Automatically updates SCHEDULE.md, .flowforge/tasks.json, and .flowforge/sessions/current.json
# Version: 2.0.0

set -euo pipefail

# Source FlowForge context
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "$SCRIPT_DIR/flowforge-context.sh" ]; then
    source "$SCRIPT_DIR/flowforge-context.sh"
fi

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

# Configuration
TIME_FILE="${TIME_FILE:-.task-times.json}"
GITHUB_TOKEN="${GITHUB_TOKEN:-}"
SESSION_TRACKER="$(dirname "$0")/session-tracker.sh"

# Generate unique instance ID for this Claude session
# Format: user@hostname:pid:timestamp
INSTANCE_ID="${CLAUDE_INSTANCE_ID:-${USER}@$(hostname):$$:$(date +%s)}"

# Function to print colored output
print_color() {
    local color=$1
    local message=$2
    echo -e "${color}${message}${NC}"
}

# Function to get current timestamp
get_timestamp() {
    date -u +"%Y-%m-%dT%H:%M:%SZ"
}

# Function to calculate duration in hours (decimal format for calculations)
calculate_duration() {
    local start=$1
    local end=$2
    local start_epoch=$(date -d "$start" +%s)
    local end_epoch=$(date -d "$end" +%s)
    local duration=$((end_epoch - start_epoch))
    
    # Convert to hours with 2 decimal places (using awk instead of bc)
    # Round to 2 decimal places to avoid floating point precision issues
    awk "BEGIN {printf \"%.2f\", $duration / 3600}"
}

# Function to format duration as HH:MM
format_duration() {
    local decimal_hours=$1
    local hours=$(echo "$decimal_hours" | awk '{print int($1)}')
    local minutes=$(echo "$decimal_hours" | awk '{print int(($1 - int($1)) * 60)}')
    printf "%02d:%02d" "$hours" "$minutes"
}

# Function to format duration from seconds
format_duration_seconds() {
    local seconds=$1
    local hours=$((seconds / 3600))
    local minutes=$(((seconds % 3600) / 60))
    printf "%02d:%02d" "$hours" "$minutes"
}

# Function to ensure time file exists
ensure_time_file() {
    if [[ ! -f "$TIME_FILE" ]]; then
        echo "{}" > "$TIME_FILE"
    fi
}

# Function to read task data
get_task_data() {
    local issue_number=$1
    ensure_time_file
    jq -r ".\"$issue_number\" // {}" "$TIME_FILE"
}

# Function to save task data
save_task_data() {
    local issue_number=$1
    local data=$2
    ensure_time_file
    
    local temp_file=$(mktemp)
    jq ".\"$issue_number\" = $data" "$TIME_FILE" > "$temp_file"
    mv "$temp_file" "$TIME_FILE"
}

# Function to start task
start_task() {
    local issue_number=$1
    local timestamp=$(get_timestamp)
    
    # Check if already started
    local task_data=$(get_task_data "$issue_number")
    if [[ $(echo "$task_data" | jq -r '.status // ""') == "active" ]]; then
        print_color "$YELLOW" "⚠️  Task #$issue_number is already active"
        return 1
    fi
    
    # Auto-pause other active tasks from THIS instance only
    print_color "$BLUE" "🔍 Checking for other active tasks in this instance..."
    local active_tasks=$(jq -r --arg instance "$INSTANCE_ID" '
        to_entries | 
        map(select(.value.status == "active" and 
                  .value.current_session.instance_id == $instance)) | 
        .[].key
    ' "$TIME_FILE" 2>/dev/null || echo "")
    
    if [ -n "$active_tasks" ]; then
        for task in $active_tasks; do
            print_color "$YELLOW" "   Auto-pausing task #$task..."
            pause_task "$task" "Auto-paused to start #$issue_number"
        done
    fi
    
    # Initialize or update task data with instance ID
    local new_data=$(echo "$task_data" | jq \
        --arg ts "$timestamp" \
        --arg user "$USER" \
        --arg instance "$INSTANCE_ID" \
        '.status = "active" | 
         .current_session = {
            start: $ts,
            user: $user,
            instance_id: $instance
         } |
         .sessions = (.sessions // [])')
    
    save_task_data "$issue_number" "$new_data"
    
    # Update GitHub label
    if [[ -n "$GITHUB_TOKEN" ]]; then
        gh issue edit "$issue_number" --add-label "status: in progress" --remove-label "status: ready,status: paused" 2>/dev/null || true
    fi
    
    # Update session tracking and documentation
    if [[ -f "$SESSION_TRACKER" ]]; then
        # Get issue description if available
        local description=""
        if command -v gh &> /dev/null && [[ -n "$GITHUB_TOKEN" ]]; then
            description=$(gh issue view "$issue_number" --json title --jq '.title' 2>/dev/null || echo "Task #$issue_number")
        fi
        bash "$SESSION_TRACKER" start "$issue_number" "$description" >/dev/null 2>&1 || true
    fi
    
    print_color "$GREEN" "✅ Started task #$issue_number at $timestamp"
    print_color "$BLUE" "💡 Use 'task-time pause $issue_number' when taking a break"
}

# Function to pause task
pause_task() {
    local issue_number=$1
    local timestamp=$(get_timestamp)
    local reason="${2:-Break}"
    
    # Check if task is active
    local task_data=$(get_task_data "$issue_number")
    if [[ $(echo "$task_data" | jq -r '.status // ""') != "active" ]]; then
        print_color "$YELLOW" "⚠️  Task #$issue_number is not active"
        return 1
    fi
    
    # Calculate session duration
    local session_start=$(echo "$task_data" | jq -r '.current_session.start')
    local duration=$(calculate_duration "$session_start" "$timestamp")
    
    # Add session to history and update status
    local new_data=$(echo "$task_data" | jq \
        --arg end "$timestamp" \
        --arg duration "$duration" \
        --arg reason "$reason" \
        '.status = "paused" |
         .current_session.end = $end |
         .current_session.duration = ($duration | tonumber) |
         .current_session.reason = $reason |
         .sessions += [.current_session] |
         del(.current_session)')
    
    save_task_data "$issue_number" "$new_data"
    
    # Update GitHub label
    if [[ -n "$GITHUB_TOKEN" ]]; then
        gh issue edit "$issue_number" --add-label "status: paused" --remove-label "status: in progress" 2>/dev/null || true
        gh issue comment "$issue_number" --body "🏃 Work session: ${duration}h - Paused: $reason" 2>/dev/null || true
    fi
    
    # Update session tracking and documentation
    if [[ -f "$SESSION_TRACKER" ]]; then
        # Calculate total hours so far
        local total_hours=$(echo "$new_data" | jq '[.sessions[].duration // 0] | add // 0')
        bash "$SESSION_TRACKER" pause "$issue_number" "$reason" "$total_hours" >/dev/null 2>&1 || true
    fi
    
    local formatted_duration=$(format_duration "$duration")
    print_color "$YELLOW" "⏸️  Paused task #$issue_number after $formatted_duration"
    print_color "$BLUE" "📝 Reason: $reason"
    print_color "$GREEN" "📋 Documentation automatically updated!"
}

# Function to unpause task
unpause_task() {
    local issue_number=$1
    local timestamp=$(get_timestamp)
    
    # Check if task is paused
    local task_data=$(get_task_data "$issue_number")
    if [[ $(echo "$task_data" | jq -r '.status // ""') != "paused" ]]; then
        print_color "$YELLOW" "⚠️  Task #$issue_number is not paused"
        return 1
    fi
    
    # Auto-pause other active tasks from THIS instance only
    print_color "$BLUE" "🔍 Checking for other active tasks in this instance..."
    local active_tasks=$(jq -r --arg instance "$INSTANCE_ID" '
        to_entries | 
        map(select(.value.status == "active" and 
                  .value.current_session.instance_id == $instance)) | 
        .[].key
    ' "$TIME_FILE" 2>/dev/null || echo "")
    
    if [ -n "$active_tasks" ]; then
        for task in $active_tasks; do
            print_color "$YELLOW" "   Auto-pausing task #$task..."
            pause_task "$task" "Auto-paused to resume #$issue_number"
        done
    fi
    
    # Resume with new session including instance ID
    local new_data=$(echo "$task_data" | jq \
        --arg ts "$timestamp" \
        --arg user "$USER" \
        --arg instance "$INSTANCE_ID" \
        '.status = "active" |
         .current_session = {
            start: $ts,
            user: $user,
            instance_id: $instance
         }')
    
    save_task_data "$issue_number" "$new_data"
    
    # Update GitHub label
    if [[ -n "$GITHUB_TOKEN" ]]; then
        gh issue edit "$issue_number" --add-label "status: in progress" --remove-label "status: paused" 2>/dev/null || true
    fi
    
    print_color "$GREEN" "▶️  Resumed task #$issue_number at $timestamp"
}

# Function to get next task from .flowforge/tasks.json
get_next_task() {
    local tasks_file="${TASKS_FILE:-.flowforge/tasks.json}"
    
    if [[ ! -f "$tasks_file" ]]; then
        echo ""
        return
    fi
    
    # Look for tasks in priority order: Critical, then Backlog
    local next_task=""
    
    # Check Critical section first
    next_task=$(sed -n '/## 🔥 Critical/,/^##/p' "$tasks_file" | grep -E "^- Issue #[0-9]+" | head -1 | grep -oE "#[0-9]+" | tr -d '#' || true)
    
    # If no critical, check Backlog
    if [[ -z "$next_task" ]]; then
        next_task=$(sed -n '/## 📋 Backlog/,/^##/p' "$tasks_file" | grep -E "^- Issue #[0-9]+" | head -1 | grep -oE "#[0-9]+" | tr -d '#' || true)
    fi
    
    echo "$next_task"
}

# Function to update .flowforge/sessions/current.json with next task
update_next_session() {
    local completed_issue=$1
    local next_issue=$2
    local next_session_file="${NEXT_SESSION_FILE:-documentation/development/.flowforge/sessions/current.json}"
    
    if [[ ! -f "$next_session_file" ]]; then
        mkdir -p "$(dirname "$next_session_file")"
        echo "# 🚀 Next Session Quick Start" > "$next_session_file"
    fi
    
    if [[ -n "$next_issue" ]]; then
        # Get issue title from GitHub if available
        local issue_title=""
        if command -v gh &> /dev/null && [[ -n "$GITHUB_TOKEN" ]]; then
            issue_title=$(gh issue view "$next_issue" --json title -q .title 2>/dev/null || echo "Issue #$next_issue")
        else
            issue_title="Issue #$next_issue"
        fi
        
        # Update .flowforge/sessions/current.json
        cat > "$next_session_file" << EOF
# 🚀 Next Session Quick Start

## Previous Work: Issue #$completed_issue ✅ COMPLETED

## Current Work: Issue #$next_issue
**Title**: $issue_title

### What's Next:
- [ ] Review issue requirements
- [ ] Write tests (TDD - Rule #3)
- [ ] Implement solution
- [ ] Update documentation

### Session Started: $(date +"%Y-%m-%d %H:%M")

### Notes:
(Ready to start work on Issue #$next_issue)

---
Generated by FlowForge task-time.sh
EOF
    else
        # No next task available
        cat > "$next_session_file" << EOF
# 🚀 Next Session Quick Start

## Previous Work: Issue #$completed_issue ✅ COMPLETED

## No Active Tasks in Queue

### What's Next:
- [ ] Run /flowforge:project:plan to create new tasks
- [ ] Check GitHub for new issues: gh issue list --state open
- [ ] Review SCHEDULE.md for upcoming milestones

### Notes:
All tasks completed! Time to plan the next sprint.

---
Generated by FlowForge task-time.sh
EOF
    fi
}

# Function to update .flowforge/tasks.json
update_tasks_md() {
    local completed_issue=$1
    local tasks_file="${TASKS_FILE:-.flowforge/tasks.json}"
    
    if [[ ! -f "$tasks_file" ]]; then
        return
    fi
    
    # Create temp file
    local temp_file="/tmp/tasks_update_$$.md"
    
    # Read the file and move completed task
    awk -v issue="$completed_issue" '
    BEGIN { in_progress=0; completed=0; found_task="" }
    /^## 🚧 In Progress/ { in_progress=1; print; next }
    /^## ✅ Completed/ { completed=1; in_progress=0 }
    /^##/ && in_progress { in_progress=0 }
    in_progress && $0 ~ "Issue #" issue {
        found_task = $0
        next
    }
    completed && found_task != "" {
        print
        print found_task " - Completed " strftime("%Y-%m-%d")
        found_task = ""
        next
    }
    { print }
    ' "$tasks_file" > "$temp_file"
    
    # Move temp file back
    mv "$temp_file" "$tasks_file"
}

# Function to update SCHEDULE.md
update_schedule_md() {
    local completed_issue=$1
    local schedule_file="${SCHEDULE_FILE:-SCHEDULE.md}"
    
    if [[ ! -f "$schedule_file" ]]; then
        return
    fi
    
    # Update the issue line to show completed with checkmark
    # Only update if the issue exists in the file
    if grep -q "Issue #${completed_issue}" "$schedule_file" 2>/dev/null; then
        # Use perl for more reliable unicode handling
        perl -pi -e "s/- \[ \] Issue #${completed_issue}/- [x] Issue #${completed_issue} ✅/g" "$schedule_file" 2>/dev/null || \
        sed -i "s/- \[ \] Issue #${completed_issue}/- \[x\] Issue #${completed_issue}/g" "$schedule_file" 2>/dev/null || true
    fi
    
    # Update progress counts
    # Count completed and total tasks in the current milestone section
    local completed=$(grep -c "\[x\]" "$schedule_file" 2>/dev/null || echo 0)
    local total=$(grep -c "Issue #" "$schedule_file" 2>/dev/null || echo 0)
    
    # Update the "Total:" line if it exists (use | as delimiter to avoid issues with /)
    if grep -q "Total:" "$schedule_file" 2>/dev/null; then
        sed -i "s|Total: .*|Total: ${completed}/${total} complete|g" "$schedule_file" 2>/dev/null || true
    fi
}

# Function to stop task (enhanced with seamless transitions)
stop_task() {
    local issue_number=$1
    local timestamp=$(get_timestamp)
    
    # Check if task has any data
    local task_data=$(get_task_data "$issue_number")
    local status=$(echo "$task_data" | jq -r '.status // ""')
    
    # If active, add final session
    if [[ "$status" == "active" ]]; then
        local session_start=$(echo "$task_data" | jq -r '.current_session.start')
        local duration=$(calculate_duration "$session_start" "$timestamp")
        
        task_data=$(echo "$task_data" | jq \
            --arg end "$timestamp" \
            --arg duration "$duration" \
            '.current_session.end = $end |
             .current_session.duration = ($duration | tonumber) |
             .sessions += [.current_session] |
             del(.current_session)')
    fi
    
    # Calculate total time
    local total_hours=$(echo "$task_data" | jq '[.sessions[].duration // 0] | add // 0')
    local session_count=$(echo "$task_data" | jq '.sessions | length')
    
    # Update final data
    local new_data=$(echo "$task_data" | jq \
        --arg ts "$timestamp" \
        --arg total "$total_hours" \
        '.status = "closed" |
         .completed_at = $ts |
         .total_hours = ($total | tonumber) |
         .metrics = {
            total_hours: ($total | tonumber),
            session_count: .sessions | length,
            average_session: (if .sessions | length > 0 then ($total | tonumber) / (.sessions | length) else 0 end)
         }')
    
    save_task_data "$issue_number" "$new_data"
    
    # Update GitHub
    local formatted_time=$(format_duration "$total_hours")
    if [[ -n "$GITHUB_TOKEN" ]]; then
        gh issue edit "$issue_number" --add-label "status: done" --remove-label "status: in progress,status: paused" 2>/dev/null || true
        gh issue comment "$issue_number" --body "✅ Task completed! Total time: ${formatted_time} (${total_hours}h) across $session_count sessions" 2>/dev/null || true
    fi
    
    # Update session tracking and documentation
    if [[ -f "$SESSION_TRACKER" ]]; then
        bash "$SESSION_TRACKER" stop "$issue_number" "Task completed" "$total_hours" >/dev/null 2>&1 || true
    fi
    
    # NEW: Update all documentation files for seamless transition
    print_color "$BLUE" "📝 Updating documentation files..."
    
    # Get next task from queue
    local next_task=$(get_next_task)
    
    # Update .flowforge/sessions/current.json
    update_next_session "$issue_number" "$next_task"
    
    # Update .flowforge/tasks.json (move to completed)
    update_tasks_md "$issue_number"
    
    # Update SCHEDULE.md (mark as complete)
    update_schedule_md "$issue_number"
    
    print_color "$GREEN" "✅ Task #$issue_number closed"
    print_color "$BLUE" "⏱️  Total time: ${formatted_time} (${total_hours}h) across $session_count sessions"
    
    # List updated files
    print_color "$GREEN" "📋 Updated files:"
    echo "   • .flowforge/sessions/current.json - Updated with next task"
    echo "   • .flowforge/tasks.json - Moved to completed section"
    echo "   • SCHEDULE.md - Progress updated"
    
    # Suggest next task if available
    if [[ -n "$next_task" ]]; then
        # Get comprehensive task details from GitHub
        local next_title=""
        local next_body=""
        local next_labels=""
        local time_estimate="Not specified"
        
        if command -v gh &> /dev/null && [[ -n "$GITHUB_TOKEN" ]]; then
            # Fetch issue details
            local issue_json=$(gh issue view "$next_task" --json title,body,labels 2>/dev/null || echo "{}")
            next_title=$(echo "$issue_json" | jq -r '.title // ""')
            next_body=$(echo "$issue_json" | jq -r '.body // ""' | head -20)
            next_labels=$(echo "$issue_json" | jq -r '.labels[].name' 2>/dev/null | tr '\n' ', ' | sed 's/,$//')
            
            # Try to extract time estimate from body or labels
            if echo "$next_body" | grep -qi "time.*estimate"; then
                time_estimate=$(echo "$next_body" | grep -i "time.*estimate" | head -1 | sed 's/.*[Ee]stimate[: ]*//' | head -c 20)
            elif echo "$next_labels" | grep -q "size:"; then
                time_estimate=$(echo "$next_labels" | grep -o "size: [^,]*" | sed 's/size: //')
            fi
        fi
        
        echo ""
        print_color "$YELLOW" "════════════════════════════════════════════════════════"
        print_color "$YELLOW" "🎯 NEXT TASK IN QUEUE"
        print_color "$YELLOW" "════════════════════════════════════════════════════════"
        echo ""
        print_color "$BLUE" "📋 Issue #$next_task${next_title:+: $next_title}"
        echo ""
        
        # Show task details
        if [[ -n "$next_body" ]]; then
            echo "📝 Description:"
            echo "$next_body" | head -5 | sed 's/^/   /'
            echo ""
        fi
        
        # Show time estimate
        print_color "$GREEN" "⏱️  Estimated Time: $time_estimate"
        echo ""
        
        # Show labels if any
        if [[ -n "$next_labels" ]]; then
            echo "🏷️  Labels: $next_labels"
            echo ""
        fi
        
        echo "💡 To start working on this task, run:"
        print_color "$BLUE" "   /flowforge:session:start $next_task"
        echo ""
        
        # If SUGGEST_NEXT_TASK env var is set, ask directly
        if [[ "${SUGGEST_NEXT_TASK:-}" == "true" ]]; then
            print_color "$YELLOW" "🚀 Ready to continue with Issue #$next_task? [Y/n]"
            echo "(This will start time tracking and switch branches)"
        fi
    else
        echo ""
        print_color "$YELLOW" "📭 No more tasks in the queue!"
        echo "   💡 Options:"
        echo "      • Run /flowforge:project:plan to create new tasks"
        echo "      • Check GitHub: gh issue list --state open"
        echo "      • Review SCHEDULE.md for upcoming work"
    fi
}

# Function to show task status
status_task() {
    local issue_number=$1
    local task_data=$(get_task_data "$issue_number")
    
    if [[ "$task_data" == "{}" ]]; then
        print_color "$YELLOW" "No time tracking data for task #$issue_number"
        return
    fi
    
    local status=$(echo "$task_data" | jq -r '.status // "unknown"')
    local total_hours=$(echo "$task_data" | jq -r '.total_hours // 0')
    local sessions=$(echo "$task_data" | jq -r '.sessions | length')
    
    # Calculate total from sessions if total_hours is not set or is 0
    if [[ "$total_hours" == "0" || "$total_hours" == "null" ]]; then
        total_hours=$(echo "$task_data" | jq '[.sessions[].duration // 0] | add // 0')
    fi
    
    # Round to 2 decimal places for display
    total_hours=$(awk "BEGIN {printf \"%.2f\", $total_hours}")
    
    print_color "$BLUE" "📊 Task #$issue_number Status"
    echo "Status: $status"
    echo "Sessions: $sessions"
    local formatted_total=$(format_duration "$total_hours")
    echo "Total Time: $formatted_total (${total_hours}h)"
    
    if [[ "$status" == "active" ]]; then
        local current_start=$(echo "$task_data" | jq -r '.current_session.start')
        local current_duration=$(calculate_duration "$current_start" "$(get_timestamp)")
        local formatted_current=$(format_duration "$current_duration")
        echo "Current Session: $formatted_current (active)"
        
        # Show instance information
        local instance_id=$(echo "$task_data" | jq -r '.current_session.instance_id // "unknown"')
        local instance_user=$(echo "$instance_id" | cut -d'@' -f1)
        local instance_host=$(echo "$instance_id" | cut -d'@' -f2 | cut -d':' -f1)
        echo "Instance: $instance_user on $instance_host"
        
        # Check if it's this instance
        if [[ "$instance_id" == "$INSTANCE_ID" ]]; then
            print_color "$GREEN" "✓ This is your active instance"
        else
            print_color "$YELLOW" "⚠️  Active in another instance: $instance_id"
        fi
    fi
    
    # Show session history
    if [[ $sessions -gt 0 ]]; then
        echo -e "\nSession History:"
        echo "$task_data" | jq -r '.sessions[] | "  - \(.start) to \(.end // "active"): \(.duration // 0)h \(.reason // "")"'
    fi
}

# Function to generate report
generate_report() {
    ensure_time_file
    
    print_color "$BLUE" "📊 Time Tracking Report"
    echo "Generated: $(get_timestamp)"
    echo ""
    
    # Summary stats
    local total_hours=$(jq '[.[].total_hours // 0] | add // 0' "$TIME_FILE")
    local active_tasks=$(jq '[.[] | select(.status == "active")] | length' "$TIME_FILE")
    local completed_tasks=$(jq '[.[] | select(.status == "completed")] | length' "$TIME_FILE")
    
    # Round to 2 decimal places
    total_hours=$(awk "BEGIN {printf \"%.2f\", $total_hours}")
    
    local formatted_total=$(format_duration "$total_hours")
    echo "Total Time: $formatted_total (${total_hours}h)"
    echo "Active Tasks: $active_tasks"
    echo "Completed Tasks: $completed_tasks"
    echo ""
    
    # Per-user breakdown
    echo "Hours by User:"
    jq -r '
        [.[].sessions[].user // "unknown"] |
        group_by(.) |
        map({user: .[0], count: length}) |
        .[] |
        "  - \(.user): \(.count) sessions"
    ' "$TIME_FILE"
    
    # Active tasks by instance
    local active_count=$(jq '[.[] | select(.status == "active")] | length' "$TIME_FILE")
    if [ "$active_count" -gt 0 ]; then
        echo -e "\nActive Tasks by Instance:"
        jq -r '
            to_entries |
            map(select(.value.status == "active")) |
            .[] |
            "  #\(.key): \(.value.current_session.instance_id // "no instance")"
        ' "$TIME_FILE"
    fi
    
    # Task details
    echo -e "\nTask Details:"
    jq -r '
        to_entries |
        map(select(.value.total_hours > 0)) |
        sort_by(.value.total_hours) |
        reverse |
        .[] |
        "  #\(.key): \(.value.total_hours | tonumber * 100 | round / 100)h (\(.value.status))"
    ' "$TIME_FILE"
}

# Main command handler
case "${1:-help}" in
    start)
        [[ -z "${2:-}" ]] && { print_color "$RED" "Usage: $0 start <issue_number>"; exit 1; }
        start_task "$2"
        ;;
    pause)
        [[ -z "${2:-}" ]] && { print_color "$RED" "Usage: $0 pause <issue_number> [reason]"; exit 1; }
        pause_task "$2" "${3:-Break}"
        ;;
    unpause|resume)
        [[ -z "${2:-}" ]] && { print_color "$RED" "Usage: $0 unpause <issue_number>"; exit 1; }
        unpause_task "$2"
        ;;
    stop|done|close)
        [[ -z "${2:-}" ]] && { print_color "$RED" "Usage: $0 close <issue_number>"; exit 1; }
        stop_task "$2"
        ;;
    status)
        [[ -z "${2:-}" ]] && { print_color "$RED" "Usage: $0 status <issue_number>"; exit 1; }
        status_task "$2"
        ;;
    report)
        generate_report
        ;;
    help|\?|*)
        cat << EOF
🕒 FlowForge Task Time Tracker

Usage: $0 <command> [args]

Commands:
  start <issue>          Start tracking time on a new task
  pause <issue> [reason] Temporarily pause work (keeps issue open)
  unpause <issue>        Resume work after a pause (alias: resume)
  close <issue>          Mark issue as COMPLETED and close it
  status <issue>         Show current time tracking details
  report                 Generate time report for all tasks
  ? or help             Show this help message

Command Details:
  
  📍 start - Begin time tracking for an issue
     - Creates new tracking session
     - Updates GitHub labels to "in progress"
     - Updates project documentation
  
  ⏸️  pause - Take a break without closing the issue
     - Records pause reason (lunch, meeting, EOD, etc.)
     - Keeps issue open for later work
     - Perfect for end of day or interruptions
  
  ▶️  unpause/resume - Continue working after a pause
     - Resumes time tracking
     - Both 'unpause' and 'resume' work the same
  
  ✅ close/done/stop - COMPLETES the issue permanently
     - Calculates total time across all sessions
     - Updates GitHub labels to "done"
     - Posts completion summary to issue
     - Updates .flowforge/tasks.json, SCHEDULE.md, .flowforge/sessions/current.json
     - All three commands (close/done/stop) do the same thing
  
  📊 status - View time tracking for an issue
     - Shows total hours worked
     - Lists all work sessions
     - Shows current session if active
  
  📈 report - Generate summary of all tracked time

Examples:
  $0 start 123          # Start working on issue #123
  $0 pause 123 "Lunch"  # Take a lunch break
  $0 unpause 123        # Back from lunch
  $0 pause 123 "EOD"    # End work for the day
  $0 unpause 123        # Start next day
  $0 close 123          # Issue completed! Close it.
  $0 ?                  # Show this help

Environment:
  GITHUB_TOKEN          GitHub token for automatic updates

Files:
  .task-times.json      Local time tracking database
  .flowforge/tasks.json             Auto-updated task list
  SCHEDULE.md          Auto-updated project schedule
  .flowforge/sessions/current.json          Auto-updated work sessions log
EOF
        ;;
esac