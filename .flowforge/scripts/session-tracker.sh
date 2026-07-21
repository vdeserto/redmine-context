#!/bin/bash
# FlowForge Session Tracker - Real-time session and schedule updates

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

# Function to format duration as HH:MM
format_duration() {
    local decimal_hours=$1
    local hours=$(echo "$decimal_hours" | awk '{print int($1)}')
    local minutes=$(echo "$decimal_hours" | awk '{print int(($1 - int($1)) * 60)}')
    printf "%02d:%02d" "$hours" "$minutes"
}

# Files
SCHEDULE_FILE="SCHEDULE.md"
TASKS_FILE=".flowforge/tasks.json"
SESSIONS_FILE="documentation/development/.flowforge/sessions/current.json"
TASK_TIMES_FILE=".task-times.json"

# Function to update session in .flowforge/sessions/current.json
update_session_log() {
    local issue_num="$1"
    local action="$2"
    local hours="${3:-0}"
    local description="${4:-}"
    local timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
    local date=$(date +"%Y-%m-%d")
    
    # Create sessions file if doesn't exist
    if [ ! -f "$SESSIONS_FILE" ]; then
        mkdir -p "$(dirname "$SESSIONS_FILE")"
        cat > "$SESSIONS_FILE" << EOF
# 📅 Development Sessions Log

Track all work sessions with real-time updates.

## 🕐 Active Sessions

| Date | Issue | Start | End | Hours | Status | Description |
|------|-------|-------|-----|-------|--------|-------------|

## 📊 Completed Sessions

| Date | Issue | Hours | Description |
|------|-------|-------|-------------|
EOF
    fi
    
    # Update based on action
    case "$action" in
        "start")
            # Check if session already exists for this issue
            if grep -q "| #$issue_num |.*Active" "$SESSIONS_FILE"; then
                echo -e "${YELLOW}⚠️  Active session already exists for issue #$issue_num${NC}"
                return 0
            fi
            
            # Add to active sessions
            sed -i "/^## 🕐 Active Sessions/,/^## 📊 Completed Sessions/ {
                /^|.*#$issue_num.*|$/d
                /^| Date | Issue | Start | End | Hours | Status | Description |$/a\\
| $date | #$issue_num | $timestamp | - | 0.00 | 🟢 Active | $description |
            }" "$SESSIONS_FILE"
            ;;
            
        "pause"|"stop")
            # Update hours for active session
            sed -i "s/| $date | #$issue_num | .* | - | [0-9.]* | .* Active | .* |/| $date | #$issue_num | - | $timestamp | $hours | 🟡 Paused | $description |/" "$SESSIONS_FILE"
            
            # If stopping, move to completed
            if [ "$action" = "stop" ]; then
                local session_line=$(grep "| $date | #$issue_num |" "$SESSIONS_FILE" | head -1)
                if [ -n "$session_line" ]; then
                    # Remove from active
                    sed -i "/| $date | #$issue_num |/d" "$SESSIONS_FILE"
                    
                    # Add to completed
                    sed -i "/^## 📊 Completed Sessions/,$ {
                        /^| Date | Issue | Hours | Description |$/a\\
| $date | #$issue_num | $hours | $description |
                    }" "$SESSIONS_FILE"
                fi
            fi
            ;;
    esac
}

# Function to update .flowforge/tasks.json
update_tasks_file() {
    local issue_num="$1"
    local hours="$2"
    local status="${3:-in-progress}"
    local date=$(date +%Y-%m-%d)
    
    if [ ! -f "$TASKS_FILE" ]; then
        return
    fi
    
    if [ "$status" = "done" ]; then
        # Extract the task line(s) for this issue
        local task_entry=$(awk -v issue="#$issue_num" '
            /^- \[.\] \*\*'$issue_num'\*\*/ {
                found = 1
                lines = $0
                next
            }
            found && /^  -/ {
                lines = lines "\n" $0
                next
            }
            found && /^- \[/ {
                found = 0
            }
            END {
                if (lines) print lines
            }
        ' "$TASKS_FILE")
        
        if [ -n "$task_entry" ]; then
            # Remove task from current location
            sed -i "/^- \[.\] \*\*#$issue_num\*\*/,/^- \[/{/^- \[.\] \*\*#$issue_num\*\*/d; /^  -/d; /^- \[/!d}" "$TASKS_FILE"
            
            # Convert checkbox to checked and add completion info
            local completed_entry=$(echo "$task_entry" | sed "s/\[ \]/\[x\]/")
            completed_entry="${completed_entry}\n  - Completed: $date\n  - Actual: ${hours}h"
            
            # Add to completed section
            awk -v entry="$completed_entry" '
                /^## ✅ Completed/ {
                    print
                    if (getline && /^- \[x\]/) {
                        print entry
                        print
                    } else {
                        print entry
                        print $0
                    }
                    next
                }
                { print }
            ' "$TASKS_FILE" > "$TASKS_FILE.tmp" && mv "$TASKS_FILE.tmp" "$TASKS_FILE"
        fi
    else
        # Just update hours for in-progress tasks
        sed -i "/#$issue_num/,/^- \[/ s/Actual: [0-9.]*h/Actual: ${hours}h/" "$TASKS_FILE"
    fi
}

# Function to update SCHEDULE.md with daily progress
update_schedule_daily() {
    local today=$(date +"%Y-%m-%d")
    local daily_hours=0
    
    # Calculate today's hours from all sessions
    if [ -f "$TASK_TIMES_FILE" ]; then
        daily_hours=$(jq -r --arg today "$today" '
            [to_entries[] | .value.sessions[]? | 
            select(.start | startswith($today)) | 
            .hours // 0] | add // 0
        ' "$TASK_TIMES_FILE")
    fi
    
    # Update or add today's entry in schedule
    if grep -q "#### $today" "$SCHEDULE_FILE" 2>/dev/null; then
        # Update existing entry
        sed -i "/#### $today/,/\*\*Day Total\*\*:/ {
            s/\*\*Day Total\*\*: [0-9.]*h/\*\*Day Total\*\*: ${daily_hours}h/
        }" "$SCHEDULE_FILE"
    else
        # Add new entry
        if grep -q "### Recent Work Sessions" "$SCHEDULE_FILE"; then
            sed -i "/### Recent Work Sessions/a\\
\\
#### $today\\
- Work in progress\\
- **Day Total**: ${daily_hours}h" "$SCHEDULE_FILE"
        fi
    fi
    
    # Update total hours
    local total_hours=$(calculate_total_project_hours)
    sed -i "s/| \*\*Total Hours Invested\*\* | [0-9.]*h |/| **Total Hours Invested** | ${total_hours}h |/" "$SCHEDULE_FILE"
}

# Function to calculate total project hours
calculate_total_project_hours() {
    if [ -f "$TASK_TIMES_FILE" ]; then
        # The JSON uses total_hours not totalHours
        jq -r '[to_entries[] | .value.total_hours // 0] | add' "$TASK_TIMES_FILE" 2>/dev/null || echo "0"
    else
        echo "0"
    fi
}

# Function to generate daily standup
generate_daily_standup() {
    local yesterday=$(date -d 'yesterday' +%Y-%m-%d)
    local today=$(date +%Y-%m-%d)
    
    echo -e "${BLUE}📋 Daily Standup Report - $today${NC}"
    echo -e "════════════════════════════════════════"
    
    echo -e "\n${GREEN}✅ Yesterday ($yesterday):${NC}"
    if [ -f "$SESSIONS_FILE" ]; then
        grep "| $yesterday |" "$SESSIONS_FILE" | grep -E "Completed|Paused" | while read -r line; do
            echo "  $line"
        done
    fi
    
    echo -e "\n${YELLOW}🎯 Today's Plan:${NC}"
    if [ -f "$TASK_TIMES_FILE" ]; then
        jq -r 'to_entries[] | select(.value.status == "active") | "  - Continue #\(.key): \(.value.description // "No description")"' "$TASK_TIMES_FILE"
    fi
    
    echo -e "\n${RED}🚧 Blockers:${NC}"
    echo "  - None reported"
    
    echo -e "\n════════════════════════════════════════"
}

# Function to handle GitHub issue events
handle_issue_event() {
    local event="$1"
    local issue_num="$2"
    
    case "$event" in
        "closed")
            # Get final hours
            local hours=$(jq -r --arg issue "$issue_num" '.[$issue].totalHours // 0' "$TASK_TIMES_FILE")
            
            # Update all files
            update_tasks_file "$issue_num" "$hours" "done"
            update_session_log "$issue_num" "stop" "$hours" "Issue closed"
            update_schedule_daily
            
            # Generate completion report
            echo -e "${GREEN}✅ Issue #$issue_num completed!${NC}"
            echo -e "   Total hours: ${hours}h"
            
            # Update GitHub issue with final report
            if command -v gh &> /dev/null; then
                gh issue comment "$issue_num" --body "## ✅ Issue Completed

**Total Time**: ${hours}h
**Completion Date**: $(date +%Y-%m-%d)

See [.flowforge/sessions/current.json](./documentation/development/.flowforge/sessions/current.json) for detailed work log."
            fi
            ;;
    esac
}

# Main function based on action
main() {
    local action="$1"
    shift
    
    case "$action" in
        "start")
            local issue_num="$1"
            local description="${2:-Working on issue #$issue_num}"
            update_session_log "$issue_num" "start" "0" "$description"
            echo -e "${GREEN}✅ Session tracking started for issue #$issue_num${NC}"
            ;;
            
        "pause"|"stop")
            local issue_num="$1"
            local description="${2:-}"
            local hours="${3:-0}"
            
            # If hours not provided, try to get from task-time.sh
            if [ "$hours" = "0" ] && [ -f "$TASK_TIMES_FILE" ]; then
                hours=$(jq -r --arg issue "$issue_num" '.[$issue].total_hours // 0' "$TASK_TIMES_FILE" 2>/dev/null || echo "0")
            fi
            
            update_session_log "$issue_num" "$action" "$hours" "$description"
            update_tasks_file "$issue_num" "$hours"
            update_schedule_daily
            echo -e "${YELLOW}⏸️  Session updated for issue #$issue_num (${hours}h)${NC}"
            ;;
            
        "close")
            handle_issue_event "closed" "$1"
            ;;
            
        "daily")
            update_schedule_daily
            echo -e "${GREEN}✅ Daily schedule updated${NC}"
            ;;
            
        "standup")
            generate_daily_standup
            ;;
            
        *)
            echo "Usage: $0 {start|pause|stop|close|daily|standup} [issue-num] [description]"
            exit 1
            ;;
    esac
}

main "$@"