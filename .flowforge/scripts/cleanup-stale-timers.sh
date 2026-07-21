#!/bin/bash

# FlowForge Stale Timer Cleanup
# Removes active timers that haven't been updated in over 24 hours
# This prevents orphaned timers from crashed sessions

set -euo pipefail

# Configuration
TIME_FILE=".task-times.json"
STALE_HOURS=24  # Hours before a timer is considered stale
DRY_RUN="${1:-false}"  # Pass "dry-run" to see what would be cleaned

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

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

# Function to check if timer is stale
is_stale() {
    local start_time=$1
    local current_epoch=$(date +%s)
    local start_epoch=$(date -d "$start_time" +%s 2>/dev/null || echo "0")
    
    if [ "$start_epoch" -eq "0" ]; then
        return 0  # Consider invalid dates as stale
    fi
    
    local hours_elapsed=$(( (current_epoch - start_epoch) / 3600 ))
    
    if [ $hours_elapsed -gt $STALE_HOURS ]; then
        return 0  # Is stale
    else
        return 1  # Not stale
    fi
}

# Check if time file exists
if [[ ! -f "$TIME_FILE" ]]; then
    print_color "$YELLOW" "No time tracking file found. Nothing to clean."
    exit 0
fi

print_color "$BLUE" "🧹 FlowForge Stale Timer Cleanup"
echo "================================"
echo "Checking for timers older than $STALE_HOURS hours..."
echo ""

# Find stale active timers
STALE_TASKS=$(jq -r '
    to_entries |
    map(select(.value.status == "active")) |
    map({
        key: .key,
        start: .value.current_session.start,
        user: .value.current_session.user,
        instance: .value.current_session.instance_id
    })
' "$TIME_FILE")

# Process each active task
CLEANED_COUNT=0
TOTAL_ACTIVE=0

echo "$STALE_TASKS" | jq -c '.[]' | while read -r task; do
    TASK_ID=$(echo "$task" | jq -r '.key')
    START_TIME=$(echo "$task" | jq -r '.start')
    USER=$(echo "$task" | jq -r '.user // "unknown"')
    INSTANCE=$(echo "$task" | jq -r '.instance // "no-instance"')
    
    ((TOTAL_ACTIVE++)) || true
    
    if is_stale "$START_TIME"; then
        print_color "$YELLOW" "Found stale timer:"
        echo "  Task: #$TASK_ID"
        echo "  Started: $START_TIME"
        echo "  User: $USER"
        echo "  Instance: $INSTANCE"
        
        if [ "$DRY_RUN" = "dry-run" ]; then
            print_color "$BLUE" "  [DRY RUN] Would pause this timer"
        else
            # Pause the stale timer
            TEMP_FILE=$(mktemp)
            jq --arg task "$TASK_ID" --arg ts "$(get_timestamp)" '
                .[$task].status = "paused" |
                .[$task].stale_cleanup = {
                    cleaned_at: $ts,
                    reason: "Stale timer cleanup (>24 hours)"
                } |
                if .[$task].current_session then
                    .[$task].sessions += [{
                        start: .[$task].current_session.start,
                        end: $ts,
                        user: .[$task].current_session.user,
                        instance_id: .[$task].current_session.instance_id,
                        duration: 0,
                        reason: "Stale cleanup"
                    }] |
                    del(.[$task].current_session)
                else . end
            ' "$TIME_FILE" > "$TEMP_FILE"
            
            mv "$TEMP_FILE" "$TIME_FILE"
            print_color "$GREEN" "  ✓ Paused stale timer"
            ((CLEANED_COUNT++)) || true
        fi
        echo ""
    fi
done

# Summary
echo "Summary:"
echo "--------"
if [ "$DRY_RUN" = "dry-run" ]; then
    print_color "$BLUE" "DRY RUN MODE - No changes made"
fi

if [ $CLEANED_COUNT -eq 0 ]; then
    print_color "$GREEN" "✅ No stale timers found. All timers are recent."
else
    print_color "$YELLOW" "🧹 Cleaned $CLEANED_COUNT stale timer(s)"
fi

# Optional: Create cleanup log
if [ $CLEANED_COUNT -gt 0 ] && [ "$DRY_RUN" != "dry-run" ]; then
    CLEANUP_LOG=".flowforge/logs/cleanup.log"
    mkdir -p "$(dirname "$CLEANUP_LOG")"
    echo "[$(date -u +"%Y-%m-%d %H:%M:%S UTC")] Cleaned $CLEANED_COUNT stale timers" >> "$CLEANUP_LOG"
fi

exit 0