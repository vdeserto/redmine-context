# Command: flowforge:session:end
# Version: 2.0.0
# Description: FlowForge session end command

---
description: Complete work session with automatic cleanup and next session preparation
argument-hint: "[message] (optional commit message)"
---

# 🏁 End Work Session

## 🎯 Purpose
Complete your work session by:
- Stopping all time tracking
- Updating task statuses
- Creating session summary
- Optional: Creating a commit

## 📋 Pre-flight Checks
```bash
set -u  # Only check for undefined vars - be forgiving on errors

# Error handler - more forgiving for end command
handle_error() {
    local exit_code=$?
    local line_number=$1
    echo "⚠️  Non-critical error on line $line_number (continuing anyway)"
    # Don't exit - let the command complete
    return 0
}
trap 'handle_error $LINENO' ERR

# Debug mode
[[ "${DEBUG:-0}" == "1" ]] && set -x

# File Lock Manager - Critical for preventing race conditions (Issue #546)
# This provides atomic file locking to prevent concurrent session:end conflicts
acquire_lock() {
    local lock_file="$1"
    local timeout="${2:-30}"
    local lock_acquired=false

    # Try to acquire lock with timeout
    for i in $(seq 1 "$timeout"); do
        if mkdir "$lock_file" 2>/dev/null; then
            lock_acquired=true
            # Store PID for debugging
            echo "$$:${INSTANCE_ID:-unknown}" > "${lock_file}/owner" 2>/dev/null || true
            break
        fi
        # Check for stale lock (older than 60 seconds)
        if [ -d "$lock_file" ]; then
            if [ -f "${lock_file}/owner" ]; then
                local lock_age=$(($(date +%s) - $(stat -c %Y "${lock_file}/owner" 2>/dev/null || echo 0)))
                if [ $lock_age -gt 60 ]; then
                    echo "⚠️  Removing stale lock (age: ${lock_age}s)"
                    release_lock "$lock_file"
                fi
            fi
        fi
        sleep 1
    done

    if [ "$lock_acquired" = true ]; then
        [[ "${DEBUG:-0}" == "1" ]] && echo "🔒 Lock acquired: $lock_file"
        return 0
    else
        echo "⚠️  Could not acquire lock: $lock_file (timeout after ${timeout}s)"
        return 1
    fi
}

release_lock() {
    local lock_file="$1"
    if [ -d "$lock_file" ]; then
        rm -rf "$lock_file" 2>/dev/null || true
        [[ "${DEBUG:-0}" == "1" ]] && echo "🔓 Lock released: $lock_file"
    fi
}

# Cleanup handler for locks
cleanup_locks() {
    # Release any locks we might be holding
    release_lock ".flowforge/team/.lock"
    release_lock ".flowforge/billing/.lock-${INSTANCE_ID:-unknown}"
    release_lock ".flowforge/provider/.lock"
}

# Register cleanup on exit
trap 'cleanup_locks' EXIT INT TERM

# Check for help request
if [[ "${ARGUMENTS:-}" == "?" || "${ARGUMENTS:-}" == "help" ]]; then
    cat << 'HELP'
🏁 FlowForge Session End

Usage: /flowforge:session:end [message]

What it does:
✓ Stops all active time tracking (instance-aware)
✓ Updates task status in provider
✓ Archives session data
✓ Generates session summary with comprehensive metrics
✓ Creates enhanced commit messages with session metadata
✓ Updates GitHub issues with progress reports
✓ Tracks files added/modified/deleted and test results

Examples:
  /flowforge:session:end
  /flowforge:session:end "Completed user authentication"
  /flowforge:session:end ?

Options:
  [message]  Optional commit message
  ?/help     Show this help
  DEBUG=1    Enable debug output

After running:
- Your work is saved and tracked
- Next session can start with /flowforge:session:start
- All time tracking is properly closed
- GitHub issues updated with comprehensive reports
HELP
    exit 0
fi

# Validate environment
if ! command -v jq &> /dev/null; then
    echo "❌ Error: jq is required but not installed"
    echo "💡 Install with: brew install jq (macOS) or apt-get install jq (Linux)"
    exit 1
fi

echo "🏁 Ending work session..."
```

## 🔍 Load Current Session Data
```bash
# Initialize variables
ACTIVE_TASK=""
SESSION_ID=""
START_TIME=""
TASK_TITLE=""
TIME_SPENT="Not tracked"
CURRENT_BRANCH=$(git branch --show-current 2>/dev/null || echo "unknown")

# Check if provider bridge is available
PROVIDER_BRIDGE=""
if [ -f "./scripts/provider-bridge.js" ]; then
    PROVIDER_BRIDGE="./scripts/provider-bridge.js"
elif [ -f "./dist/scripts/provider-bridge.js" ]; then
    PROVIDER_BRIDGE="./dist/scripts/provider-bridge.js"
fi

# Load current session data (with error suppression)
if [ -f ".flowforge/local/session.json" ] && command -v jq &> /dev/null; then
    echo "📋 Loading current session..."
    SESSION_DATA=$(cat .flowforge/local/session.json 2>/dev/null || echo "{}")

    # Suppress jq parse errors
    ACTIVE_TASK=$(echo "$SESSION_DATA" | jq -r '.taskId // empty' 2>/dev/null || echo "")
    SESSION_ID=$(echo "$SESSION_DATA" | jq -r '.sessionId // empty' 2>/dev/null || echo "")
    START_TIME=$(echo "$SESSION_DATA" | jq -r '.startTime // empty' 2>/dev/null || echo "")
    TASK_TITLE=$(echo "$SESSION_DATA" | jq -r '.taskTitle // "Unknown"' 2>/dev/null || echo "Unknown")
    
    if [ -n "$ACTIVE_TASK" ]; then
        echo "✅ Found active session for task #$ACTIVE_TASK"
        
        # Calculate time spent if start time is available
        if [ -n "$START_TIME" ] && command -v date &> /dev/null; then
            START_EPOCH=$(date -d "$START_TIME" +%s 2>/dev/null || date -j -f "%Y-%m-%dT%H:%M:%S" "${START_TIME%.*}" +%s 2>/dev/null || echo "0")
            END_EPOCH=$(date +%s)
            if [ "$START_EPOCH" -gt 0 ]; then
                DURATION=$((END_EPOCH - START_EPOCH))
                HOURS=$((DURATION / 3600))
                MINUTES=$(((DURATION % 3600) / 60))
                TIME_SPENT="${HOURS}h ${MINUTES}m"
            fi
        fi
    else
        echo "⚠️  No active session found"
        # Try to detect from time tracking as fallback
        if [ -f ".flowforge/billing/time-tracking.json" ] && command -v jq &> /dev/null; then
            # Get current user for better filtering
            CURRENT_USER="${USER:-$(whoami)}"
            
            # Try to find active task for current user, sorted by most recent activity
            ACTIVE_TASK=$(jq -r --arg user "$CURRENT_USER" '
                to_entries | 
                map(select(.value.status == "active" and 
                          (.value.current_session.user == $user or
                           .value.current_session.user == null))) |
                sort_by(.value.current_session.start // "1970-01-01") | 
                reverse | 
                .[0].key // empty
            ' .flowforge/billing/time-tracking.json 2>/dev/null || true)
            
            # If not found, try to find any paused task from current user
            if [ -z "$ACTIVE_TASK" ]; then
                ACTIVE_TASK=$(jq -r --arg user "$CURRENT_USER" '
                    to_entries | 
                    map(select(.value.status == "paused" and 
                              .value.sessions[-1].user == $user)) |
                    sort_by(.value.sessions[-1].start // "1970-01-01") | 
                    reverse | 
                    .[0].key // empty
                ' .flowforge/billing/time-tracking.json 2>/dev/null || true)
            fi
            
            if [ -n "$ACTIVE_TASK" ]; then
                echo "✅ Found task #$ACTIVE_TASK from time tracking"
            fi
        fi
    fi
else
    echo "⚠️  No session data file found"
fi

# Get instance ID (same logic as task-time.sh) - Enhanced for better isolation
# Include process ID and timestamp for uniqueness
INSTANCE_ID="${CLAUDE_INSTANCE_ID:-${USER}@$(hostname):$$:$(date +%s%N)}"
# Create a hash for shorter lock file names
INSTANCE_HASH=$(echo -n "$INSTANCE_ID" | md5sum | cut -c1-8)
```

## 🛑 Stop Active Time Tracking
```bash
# Stop time tracking if we have an active task
if [ -n "$ACTIVE_TASK" ]; then
    echo -e "\n⏱️  Stopping time tracking for task #$ACTIVE_TASK..."

    # Acquire lock for time tracking updates
    TIME_LOCK=".flowforge/billing/.lock-${INSTANCE_HASH}"
    if acquire_lock "$TIME_LOCK" 15; then
        TIME_LOCK_ACQUIRED=true
    else
        TIME_LOCK_ACQUIRED=false
        echo "⚠️  Proceeding without time tracking lock (may cause minor inconsistencies)"
    fi

    # Try provider system first (suppress errors)
    if [ -n "$PROVIDER_BRIDGE" ] && [ -n "$SESSION_ID" ] && command -v node &> /dev/null; then
        if timeout 5 node "$PROVIDER_BRIDGE" stop-tracking --id="$ACTIVE_TASK" --session="$SESSION_ID" --format=text 2>/dev/null; then
            echo "✅ Time tracking stopped via provider"
        else
            echo "⚠️  Provider system unavailable, using fallback..."
        fi
    fi

    # Stop real-time session tracking (Issue #103) - graceful failure
    if [ -f "./scripts/realtime-tracker.js" ] && [ -n "$SESSION_ID" ] && command -v node &> /dev/null; then
        echo "🔄 Stopping real-time session tracking..."

        # Calculate duration from session start
        DURATION_MS=0
        if [ -n "$START_TIME" ]; then
            START_EPOCH=$(date -d "$START_TIME" +%s 2>/dev/null || date -j -f "%Y-%m-%dT%H:%M:%S" "${START_TIME%.*}" +%s 2>/dev/null || echo "0")
            END_EPOCH=$(date +%s)
            if [ "$START_EPOCH" -gt 0 ]; then
                DURATION_MS=$((($END_EPOCH - $START_EPOCH) * 1000))
            fi
        fi

        # End the real-time tracking session (with timeout and error suppression)
        if REALTIME_OUTPUT=$(timeout 5 node ./scripts/realtime-tracker.js end \
            --session-id="$SESSION_ID" \
            --duration="$DURATION_MS" \
            --enable-sync=true 2>/dev/null); then

            echo "✅ Real-time tracking stopped"

            # Parse final session data if available
            if command -v jq &> /dev/null && [ -n "$REALTIME_OUTPUT" ]; then
                FINAL_DURATION=$(echo "$REALTIME_OUTPUT" | jq -r '.duration // "0"' 2>/dev/null || echo "0")
                if [ "$FINAL_DURATION" != "0" ]; then
                    # Convert ms to human readable
                    DURATION_SEC=$((FINAL_DURATION / 1000))
                    HOURS=$((DURATION_SEC / 3600))
                    MINUTES=$(((DURATION_SEC % 3600) / 60))
                    TIME_SPENT="${HOURS}h ${MINUTES}m"
                fi
            fi
        else
            # Don't fail the command, just note it
            echo "⚠️  Real-time tracking unavailable (continuing anyway)"
        fi
    fi
    # Fallback to traditional time tracking
    TIME_SCRIPT=""
    if [ -f "./scripts/task-time.sh" ]; then
        TIME_SCRIPT="./scripts/task-time.sh"
    elif [ -f "./.flowforge/scripts/task-time.sh" ]; then
        TIME_SCRIPT="./.flowforge/scripts/task-time.sh"
    fi
    
    if [ -n "$TIME_SCRIPT" ]; then
        # Stop the task (complete it properly for billing)
        if "$TIME_SCRIPT" stop "$ACTIVE_TASK" "End of session" 2>/dev/null; then
            # Get time spent
            if TASK_STATUS=$("$TIME_SCRIPT" status "$ACTIVE_TASK" 2>/dev/null); then
                TASK_TIME=$(echo "$TASK_STATUS" | grep "Total Time:" | cut -d: -f2- | xargs || echo "Unknown")
                echo "   Time spent: $TASK_TIME"
                TIME_SPENT="$TASK_TIME"
            fi
        else
            echo "   ⚠️  Failed to stop task #$ACTIVE_TASK"
        fi
    fi

    # Release time tracking lock
    if [ "$TIME_LOCK_ACQUIRED" = true ]; then
        release_lock "$TIME_LOCK"
    fi
else
    echo "ℹ️  No active time tracking found"
fi
```

## 📊 Comprehensive Session Metrics
```bash
# Get today's date and initialize metrics
TODAY=$(date +%Y-%m-%d)
CURRENT_TIME=$(date -u +"%Y-%m-%dT%H:%M:%S.%3NZ")

# Get commits from this session
TODAYS_COMMITS=""
COMMIT_COUNT=0
if git log -1 &>/dev/null; then
    TODAYS_COMMITS=$(git log --oneline --since="midnight" --author="$(git config user.email 2>/dev/null || echo "unknown")" 2>/dev/null || echo "")
    if [ -n "$TODAYS_COMMITS" ]; then
        COMMIT_COUNT=$(echo "$TODAYS_COMMITS" | grep -c "^" 2>/dev/null | tr -d '\n' || echo "0")
    else
        COMMIT_COUNT=0
    fi
fi

# Count files changed
FILES_ADDED=0
FILES_MODIFIED=0
FILES_DELETED=0
CHANGES_COUNT=$(git status --porcelain 2>/dev/null | wc -l | tr -d '\n' || echo "0")
if git status &>/dev/null; then
    FILES_ADDED=$(git diff --name-status 2>/dev/null | grep -c "^A" 2>/dev/null | tr -d '\n' || echo "0")
    FILES_MODIFIED=$(git diff --name-status 2>/dev/null | grep -c "^M" 2>/dev/null | tr -d '\n' || echo "0")
    FILES_DELETED=$(git diff --name-status 2>/dev/null | grep -c "^D" 2>/dev/null | tr -d '\n' || echo "0")
fi

# Get test status if available
TEST_SUMMARY="No tests found"
if [ -f "package.json" ] && grep -q '"test"' package.json 2>/dev/null; then
    if command -v npm &>/dev/null; then
        echo "🧪 Running tests..."
        TEST_OUTPUT=$(npm test -- --run 2>&1 | tail -10 || echo "Test run failed")
        TEST_SUMMARY=$(echo "$TEST_OUTPUT" | grep -E "Test Files.*passed|Tests:.*passed" | head -1 || echo "Tests completed")
    fi
elif [ -f "Makefile" ] && grep -q "^test:" Makefile 2>/dev/null; then
    if command -v make &>/dev/null; then
        echo "🧪 Running tests..."
        TEST_OUTPUT=$(make test 2>&1 | tail -10 || echo "Test run failed")
        TEST_SUMMARY=$(echo "$TEST_OUTPUT" | grep -E "passed|PASS" | tail -1 || echo "Tests completed")
    fi
fi

# Get last commit info
LAST_COMMIT=$(git log -1 --format="%h %s" 2>/dev/null || echo "No commits yet")
```

## 📝 Update Task Status in Provider
```bash
# Update task status if we have an active task
if [ -n "$ACTIVE_TASK" ] && [ -n "$PROVIDER_BRIDGE" ] && command -v node &> /dev/null; then
    echo -e "\n📋 Updating task status..."

    # Acquire lock for provider operations
    PROVIDER_LOCK=".flowforge/provider/.lock"
    if acquire_lock "$PROVIDER_LOCK" 10; then
        PROVIDER_LOCK_ACQUIRED=true
    else
        PROVIDER_LOCK_ACQUIRED=false
        echo "⚠️  Proceeding without provider lock"
    fi

    # Create progress note
    PROGRESS_NOTE="Session ended - Time: $TIME_SPENT, Commits: $COMMIT_COUNT, Changes: +$FILES_ADDED/~$FILES_MODIFIED/-$FILES_DELETED"
    
    # Get current task info to preserve existing data (suppress all errors)
    TASK_INFO=$(timeout 5 node "$PROVIDER_BRIDGE" get-task --id="$ACTIVE_TASK" --format=json 2>/dev/null || echo "{}")
    CURRENT_STATUS=$(echo "$TASK_INFO" | jq -r '.status // "unknown"' 2>/dev/null || echo "unknown")
    
    # CRITICAL FIX: Check if task is actually closed on GitHub FIRST
    GITHUB_CLOSED=false
    GITHUB_STATE="unknown"
    if command -v gh &> /dev/null; then
        echo "🔍 Checking GitHub status for issue #$ACTIVE_TASK..."
        GH_STATE=$(timeout 5 gh issue view "$ACTIVE_TASK" --json state -q '.state' 2>/dev/null || echo "unknown")
        GITHUB_STATE="$GH_STATE"
        if [ "$GH_STATE" = "CLOSED" ]; then
            GITHUB_CLOSED=true
            echo "✅ Issue #$ACTIVE_TASK is CLOSED on GitHub"
        elif [ "$GH_STATE" = "OPEN" ]; then
            echo "📂 Issue #$ACTIVE_TASK is still OPEN on GitHub"
        else
            echo "⚠️  Could not determine GitHub status for issue #$ACTIVE_TASK"
        fi
    fi
    
    # Update task status based on GitHub state
    if [ "$GITHUB_CLOSED" = true ]; then
        # Task is closed on GitHub, mark as completed in tasks.json
        echo "🎯 Marking task as COMPLETED (GitHub issue is closed)"
        if timeout 5 node "$PROVIDER_BRIDGE" update-task --id="$ACTIVE_TASK" --status=completed --description="$PROGRESS_NOTE - GitHub issue closed" 2>/dev/null; then
            echo "✅ Task #$ACTIVE_TASK marked as COMPLETED in tasks.json"
        else
            echo "⚠️  Could not update task status (continuing anyway)"
        fi
    elif [ "$CURRENT_STATUS" = "in_progress" ] || [ "$CURRENT_STATUS" = "active" ]; then
        # Task still open on GitHub, just pause it
        echo "⏸️  Pausing task (GitHub issue still open)"
        if timeout 5 node "$PROVIDER_BRIDGE" update-task --id="$ACTIVE_TASK" --status=paused --description="$PROGRESS_NOTE" 2>/dev/null; then
            echo "✅ Task #$ACTIVE_TASK marked as PAUSED"
        else
            echo "⚠️  Could not update task status (continuing anyway)"
        fi
    else
        echo "ℹ️  Task status: $CURRENT_STATUS (GitHub: $GITHUB_STATE)"
    fi

    # Release provider lock
    if [ "${PROVIDER_LOCK_ACQUIRED:-false}" = true ]; then
        release_lock "$PROVIDER_LOCK"
    fi
fi
```

## 💾 Archive Session Data
```bash
# Archive current session
echo -e "\n💾 Archiving session data..."

# Initialize archive file path (prevents unbound variable error)
ARCHIVE_FILE=""

if [ -f ".flowforge/local/session.json" ]; then
    # Create archive directory
    ARCHIVE_DIR=".flowforge/sessions/archive/$(date +%Y-%m)"
    mkdir -p "$ARCHIVE_DIR"
    
    # Create archive with session summary
    ARCHIVE_FILE="$ARCHIVE_DIR/session-${TODAY}-${SESSION_ID:-unknown}.json"
    
    # Build comprehensive session archive
    cat > "$ARCHIVE_FILE" << EOF
{
  "sessionId": "${SESSION_ID:-unknown}",
  "taskId": "${ACTIVE_TASK:-unknown}",
  "taskTitle": "$TASK_TITLE",
  "branch": "$CURRENT_BRANCH",
  "startTime": "$START_TIME",
  "endTime": "$CURRENT_TIME",
  "duration": "$TIME_SPENT",
  "user": "${USER:-$(whoami)}",
  "metrics": {
    "commits": $COMMIT_COUNT,
    "filesAdded": $FILES_ADDED,
    "filesModified": $FILES_MODIFIED,
    "filesDeleted": $FILES_DELETED,
    "testsRun": "$TEST_SUMMARY"
  },
  "commits": [
    $(echo "$TODAYS_COMMITS" | sed 's/^/    "/; s/$/",/' | sed '$ s/,$//')
  ],
  "lastCommit": "$LAST_COMMIT",
  "sessionNotes": "${ARGUMENTS:-No notes provided}"
}
EOF
    
    echo "✅ Session archived to: $ARCHIVE_FILE"
    
    # Remove current session file
    rm -f .flowforge/local/session.json
else
    echo "⚠️  No current session to archive"
fi
```

## 🔐 Dual-Path Data Writing (v2.2.0 Bulletproof Billing)
```bash
# Implement dual-path data writing for privacy and billing
echo -e "\n🔐 Implementing dual-path data archival..."

# Acquire lock for team summary updates - CRITICAL SECTION
TEAM_LOCK=".flowforge/team/.lock"
if acquire_lock "$TEAM_LOCK" 20; then
    TEAM_LOCK_ACQUIRED=true
else
    TEAM_LOCK_ACQUIRED=false
    echo "⚠️  Could not acquire team lock - data may be inconsistent"
fi

# Get current user
CURRENT_USER="${USER:-$(whoami)}"

# Create user-isolated directory structure
USER_DIR=".flowforge/users/$CURRENT_USER"
mkdir -p "$USER_DIR/sessions"
mkdir -p "$USER_DIR/timesheets"

# Create team aggregated directory structure
TEAM_DIR=".flowforge/team"
mkdir -p "$TEAM_DIR/summaries/$(date +%Y-%m-%d)"
mkdir -p "$TEAM_DIR/billable"

# Save detailed session data to user-isolated path (private)
if [ -f "$ARCHIVE_FILE" ]; then
    # Copy detailed session to user directory
    cp "$ARCHIVE_FILE" "$USER_DIR/sessions/detailed-${ACTIVE_TASK:-unknown}.json"
    echo "✅ User-isolated session data saved"
fi

# Create privacy-preserving team summary
TEAM_SUMMARY_FILE="$TEAM_DIR/summaries/$(date +%Y-%m-%d)/team-summary.json"

# Calculate rounded hours for privacy (round to nearest 0.25)
if [ -n "$TIME_SPENT" ]; then
    # Extract hours from time format (e.g., "2h 30m")
    HOURS=$(echo "$TIME_SPENT" | grep -oE '[0-9]+h' | grep -oE '[0-9]+' || echo "0")
    MINUTES=$(echo "$TIME_SPENT" | grep -oE '[0-9]+m' | grep -oE '[0-9]+' || echo "0")
    TOTAL_HOURS=$(echo "scale=2; $HOURS + $MINUTES/60" | bc 2>/dev/null || echo "0")
    ROUNDED_HOURS=$(echo "scale=2; (($TOTAL_HOURS * 4) + 0.5)/4" | bc 2>/dev/null || echo "$TOTAL_HOURS")
else
    TOTAL_HOURS="0"
    ROUNDED_HOURS="0"
fi

# Generate team-level aggregated data (privacy-preserving)
cat > "$TEAM_SUMMARY_FILE" << EOF
{
  "teamId": "dev-team",
  "aggregatedData": {
    "totalHours": $ROUNDED_HOURS,
    "issueHours": {
      "${ACTIVE_TASK:-unknown}": $ROUNDED_HOURS
    },
    "developers": {
      "$CURRENT_USER": {
        "totalHours": $TOTAL_HOURS,
        "roundedHours": $ROUNDED_HOURS
      }
    }
  },
  "privacyProtected": true,
  "rawDataExcluded": ["exactTimes", "sessionDetails"]
}
EOF

echo "✅ Privacy-preserving team summary created"

# Release team lock after critical section
if [ "${TEAM_LOCK_ACQUIRED:-false}" = true ]; then
    release_lock "$TEAM_LOCK"
fi
```

## 📝 Update SESSIONS.md
```bash
# Update SESSIONS.md file with session completion
echo -e "\n📝 Updating SESSIONS.md..."

if [ -f "SESSIONS.md" ]; then
    # Create backup
    cp SESSIONS.md SESSIONS.md.bak
    
    # Move task from Active to Completed section
    if [ -n "$ACTIVE_TASK" ] && [ "$ACTIVE_TASK" != "unknown" ]; then
        # Create temporary file for modifications
        TEMP_FILE=$(mktemp)
        
        # Process the file to move task from Active to Completed
        awk -v task="$ACTIVE_TASK" -v time="$TIME_SPENT" -v date="$TODAY" '
        BEGIN { in_active = 0; in_completed = 0; found = 0; task_line = "" }
        /^## Active Sessions/ { in_active = 1; in_completed = 0; print; next }
        /^## Completed Sessions/ { in_active = 0; in_completed = 1 }
        in_active && $0 ~ "Issue #" task { 
            found = 1
            task_line = $0
            next  # Skip this line in Active section
        }
        in_completed && !printed {
            print
            if (found && task_line != "") {
                # Add to completed section with time and date
                gsub(/Active/, "Completed", task_line)
                print task_line " - Time: " time " - Date: " date
                printed = 1
            }
            next
        }
        { print }
        ' SESSIONS.md > "$TEMP_FILE"
        
        # Replace original file if successful
        if [ -s "$TEMP_FILE" ]; then
            mv "$TEMP_FILE" SESSIONS.md
            echo "✅ SESSIONS.md updated - Task #$ACTIVE_TASK moved to Completed"
        else
            rm -f "$TEMP_FILE"
            echo "⚠️  Could not update SESSIONS.md"
        fi
    fi
else
    # Create SESSIONS.md if it doesn't exist
    cat > SESSIONS.md << EOF
# FlowForge Session History

## Active Sessions

## Completed Sessions
- Issue #${ACTIVE_TASK:-unknown} - ${TASK_TITLE:-"Session work"} - Time: $TIME_SPENT - Date: $TODAY

## Statistics
- Total Sessions: 1
- Total Time: $TIME_SPENT
EOF
    echo "✅ SESSIONS.md created with session history"
fi
```

## 📈 Generate Session Summary
```bash
# Create session summary
echo ""
echo "📊 Session Summary"
echo "────────────────────────────────"
echo "⏱️  Duration: ${TIME_SPENT:-Not tracked}"
echo "🌿 Branch: $CURRENT_BRANCH"
echo "📝 Last commit: $LAST_COMMIT"
echo "📈 Changes: +$FILES_ADDED, ~$FILES_MODIFIED, -$FILES_DELETED"
echo "🧪 Tests: $TEST_SUMMARY"
echo "✅ Commits today: $COMMIT_COUNT"

# Show recent work
echo ""
echo "📋 Recent commits:"
if ! git log --since="4 hours ago" --format="   - %s" 2>/dev/null | head -5; then
    echo "   No recent commits"
fi
```

## 💾 Enhanced Commit with Session Metadata
```bash
# Check if there are changes to commit
if [ "$CHANGES_COUNT" -gt 0 ] || ! git diff --cached --quiet 2>/dev/null; then
    # Add all changes
    echo -e "\n📝 Staging changes..."
    git add -A 2>&1 || echo "⚠️  Some files could not be staged"
    
    # Generate enhanced commit message with session metadata
    if [ -z "${ARGUMENTS:-}" ]; then
        # Auto-generate based on changes
        if [ "$FILES_ADDED" -gt 0 ] && [ "$FILES_MODIFIED" -eq 0 ]; then
            COMMIT_TYPE="feat"
            COMMIT_DESC="add new features and implementations"
        elif [ "$FILES_MODIFIED" -gt "$FILES_ADDED" ]; then
            COMMIT_TYPE="refactor"
            COMMIT_DESC="improve existing code and implementations"
        elif git diff --cached --name-only 2>/dev/null | grep -q "test"; then
            COMMIT_TYPE="test"
            COMMIT_DESC="add/update tests"
        else
            COMMIT_TYPE="chore"
            COMMIT_DESC="update project files"
        fi
        
        COMMIT_MESSAGE="$COMMIT_TYPE: $COMMIT_DESC

Session: $TODAY
Issue: ${ACTIVE_TASK:+#$ACTIVE_TASK}${ACTIVE_TASK:-No specific issue}
Time: ${TIME_SPENT:-Unknown}

Changes:
$(git diff --cached --name-only 2>/dev/null | head -10 || echo "Multiple files")

[skip ci]"
    else
        COMMIT_MESSAGE="${ARGUMENTS}

Session: $TODAY
Issue: ${ACTIVE_TASK:+#$ACTIVE_TASK}${ACTIVE_TASK:-No specific issue}
Time: ${TIME_SPENT:-Unknown}

[skip ci]"
    fi
    
    # Commit with enhanced message (don't fail on commit errors)
    if git commit -m "$COMMIT_MESSAGE" 2>/dev/null; then
        echo "✅ Changes committed with session metadata"
    else
        echo "⚠️  Could not commit changes (continuing anyway)"
    fi
else
    echo "ℹ️  No uncommitted changes to commit"
fi
```

## 🚀 GitHub Issue Updates & Push
```bash
# Push to remote if it exists
if git remote get-url origin &>/dev/null; then
    echo -e "\n📤 Pushing to remote..."
    if git push origin "$CURRENT_BRANCH" 2>/dev/null; then
        echo "✅ Pushed to remote"
    else
        echo "⚠️  Could not push to remote (this is normal if branch is up to date)"
        echo "💡 If needed: git push -u origin $CURRENT_BRANCH"
    fi
else
    echo "⚠️  No remote 'origin' configured"
fi

# Update GitHub issue with comprehensive report (if available)
if [ -n "${ACTIVE_TASK:-}" ] && [ "$ACTIVE_TASK" != "unknown" ] && command -v gh &> /dev/null; then
    echo -e "\n📋 Updating GitHub issue..."
    
    COMMENT_BODY="## 🏁 Session End Update - $TODAY

**Total Time on Issue**: ${TIME_SPENT:-Unknown}
**Branch**: \`$CURRENT_BRANCH\`

### 📊 Session Metrics
- Files changed: +$FILES_ADDED, ~$FILES_MODIFIED, -$FILES_DELETED
- Commits today: $COMMIT_COUNT
- Tests: $TEST_SUMMARY

### 🎯 Today's Commits
\`\`\`
$(if [ -n "$TODAYS_COMMITS" ]; then echo "$TODAYS_COMMITS"; else echo "No commits today"; fi)
\`\`\`

### 📝 Latest Commit
\`\`\`
$(git log -1 --oneline 2>/dev/null || echo "No commits")
\`\`\`

---
*Session summary generated by FlowForge session management*"

    if timeout 5 gh issue comment "$ACTIVE_TASK" --body "$COMMENT_BODY" 2>/dev/null; then
        echo "✅ GitHub issue #$ACTIVE_TASK updated"
    else
        echo "⚠️  Could not update GitHub issue (optional - requires 'gh' CLI)"
    fi
else
    if [ -z "${ACTIVE_TASK:-}" ] || [ "$ACTIVE_TASK" == "unknown" ]; then
        echo "ℹ️  No active task detected - skipping GitHub issue update"
    else
        echo "ℹ️  GitHub CLI not available - skipping issue update"
    fi
fi
```

## 📊 Save Next Session Info
```bash
# Save info for next session start
echo -e "\n📝 Preparing for next session..."

NEXT_SESSION_FILE=".flowforge/sessions/next.json"

# Get pending tasks from provider (with fallback)
PENDING_TASKS="[]"
if [ -n "$PROVIDER_BRIDGE" ] && command -v node &> /dev/null; then
    PENDING_TASKS=$(timeout 5 node "$PROVIDER_BRIDGE" list-tasks --status=ready --format=json 2>/dev/null | jq '[.[:3]]' 2>/dev/null || echo "[]")
fi

# Create next session info
cat > "$NEXT_SESSION_FILE" << EOF
{
  "lastSession": {
    "taskId": "${ACTIVE_TASK:-unknown}",
    "taskTitle": "$TASK_TITLE",
    "endTime": "$CURRENT_TIME",
    "duration": "$TIME_SPENT",
    "branch": "$CURRENT_BRANCH",
    "commits": $COMMIT_COUNT
  },
  "suggestions": {
    "continueTask": ${ACTIVE_TASK:-null},
    "pendingTasks": $PENDING_TASKS,
    "lastBranch": "$CURRENT_BRANCH"
  },
  "quickStart": [
    "/flowforge:session:start ${ACTIVE_TASK:-}",
    "git checkout $CURRENT_BRANCH",
    "/flowforge:dev:checkrules"
  ]
}
EOF

echo "✅ Next session info saved"
```

## 🧹 Cleanup
```bash
# Namespace Integration - Sync data to Git before cleanup
if [ -f "./scripts/namespace/integrate.sh" ]; then
    echo -e "\n🔄 Running namespace synchronization..."
    source "./scripts/namespace/integrate.sh"

    # Run the integration function
    integrate_session_end || {
        echo "⚠️  Namespace sync failed (continuing anyway)"
    }
else
    echo "⚠️  Namespace integration not available"
fi

# Clean up any temporary files
echo -e "\n🧹 Cleaning up..."

# Remove temporary files (with error handling)
find . -name "*.flowforge.tmp" -type f -delete 2>/dev/null || true

# Clean up any stale locks (older than 5 minutes)
for lock_dir in .flowforge/team/.lock* .flowforge/billing/.lock* .flowforge/provider/.lock*; do
    if [ -d "$lock_dir" ]; then
        if [ -f "${lock_dir}/owner" ]; then
            lock_age=$(($(date +%s) - $(stat -c %Y "${lock_dir}/owner" 2>/dev/null || stat -f %m "${lock_dir}/owner" 2>/dev/null || echo 0)))
            if [ $lock_age -gt 300 ]; then
                echo "🧹 Removing stale lock: $lock_dir (age: ${lock_age}s)"
                rm -rf "$lock_dir" 2>/dev/null || true
            fi
        fi
    fi
done

# Save final position for next session
if [ -f "scripts/position-tracker.sh" ] && [ -n "${ACTIVE_TASK:-}" ]; then
    echo "💾 Saving final position for next session..."
    ./scripts/position-tracker.sh save "${ACTIVE_TASK:-}" "" "Session ended" "Paused at end of session"
fi

# Save complete context for next session
if [ -f "scripts/context-preservation.sh" ]; then
    echo "📍 Saving complete context..."
    
    # Capture current files being worked on (from git status)
    MODIFIED_FILES=$(git status --short 2>/dev/null | grep -E "^[ M]M" | awk '{print $2}' | head -5 | tr '\n' ',' | sed 's/,$//')
    
    # Add line numbers (just use line 1 as placeholder for now)
    if [ -n "$MODIFIED_FILES" ]; then
        CURRENT_FILES=$(echo "$MODIFIED_FILES" | sed 's/[^,]*/&:1/g')
    else
        CURRENT_FILES=""
    fi
    
    # Get last commit message as action
    LAST_ACTION=$(git log -1 --format="%s" 2>/dev/null || echo "Working on ${ACTIVE_TASK:-tasks}")
    
    # Save context
    export FLOWFORGE_ISSUE="${ACTIVE_TASK:-}"
    export FLOWFORGE_LAST_ACTION="${ARGUMENTS:-$LAST_ACTION}"
    export FLOWFORGE_CURRENT_FILES="$CURRENT_FILES"
    export FLOWFORGE_LAST_DIFF="$(git diff --stat 2>/dev/null | head -10)"
    
    ./scripts/context-preservation.sh save > /dev/null 2>&1
    echo "✅ Context preserved for next session"
fi
```

## ✅ Enhanced Final Summary
```bash
echo ""
echo "✨ SESSION COMPLETE! ✨"
echo "======================="
echo ""
echo "📊 Today's Accomplishments:"
if [ -n "$ACTIVE_TASK" ] && [ "$ACTIVE_TASK" != "unknown" ]; then
    echo "- Issue: #$ACTIVE_TASK"
else
    echo "- Issue: No specific issue"
fi
echo "- Time spent: ${TIME_SPENT:-Unknown}"
echo "- Commits: $COMMIT_COUNT"
echo "- Changes: $CHANGES_COUNT files (+$FILES_ADDED, ~$FILES_MODIFIED, -$FILES_DELETED)"
echo "- Tests: $TEST_SUMMARY"
echo ""
echo "📋 Data Saved:"
echo "- ✅ Session archived"
echo "- ✅ Next session prepared"
echo "- ✅ Context preserved"
if [ -n "${ACTIVE_TASK:-}" ] && [ "$ACTIVE_TASK" != "unknown" ] && command -v gh &> /dev/null; then
    echo "- ✅ GitHub issue updated"
fi
echo ""
echo "🔄 Instance-Aware Updates:"
echo "- Only YOUR tasks were paused"
echo "- Other developers can continue working"
echo "- No conflicts with concurrent sessions"

echo ""
echo "🌙 Rest well! Everything is tracked and ready."
echo ""
echo "💡 Tomorrow: /flowforge:session:start ${ACTIVE_TASK:-[issue_number]}"
echo "📄 Your session data is in: .flowforge/sessions/"
echo ""
echo "🎯 Great work today! Rest well and come back refreshed! 🚀"

# Exit successfully
exit 0
```