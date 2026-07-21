# Command: flowforge:session:pause
# Version: 2.0.0
# Description: FlowForge session pause command

---
description: Quick pause - Switch tasks or take a break without the full ceremony
argument-hint: "[commit-message]"
---

# ⏸️ Quick Pause - Light Speed Task Switch

Taking a break or jumping to another task? This command gets you out fast:
- 💾 Saves your work
- ⏱️ Pauses the timer  
- 🚀 Pushes to remote
- 💬 Updates the issue

**Perfect for**: Coffee breaks, context switches, quick meetings, or "my brain needs a different problem for 30 minutes"

No documentation overhead. No ceremony. Just a clean pause.

```bash
set -euo pipefail  # Exit on error, undefined vars, pipe failures

# Error handler
handle_error() {
    local exit_code=$?
    local line_number=$1
    echo "❌ Error on line $line_number (exit code: $exit_code)"
    echo "💡 Debug with: DEBUG=1 /flowforge:session:pause"
    exit $exit_code
}
trap 'handle_error $LINENO' ERR

# Debug mode
[[ "${DEBUG:-0}" == "1" ]] && set -x

# Check for help request
if [[ "${ARGUMENTS:-}" == "?" || "${ARGUMENTS:-}" == "help" ]]; then
    cat << 'HELP'
⏸️ FlowForge Session Pause

Usage: /flowforge:session:pause [commit-message]

What it does:
✓ Pauses time tracking (not stop - keeps issue open)
✓ Saves session state
✓ Commits and pushes any changes
✓ Updates GitHub issue with progress
✓ Allows quick task switching

Perfect for:
- Coffee breaks ☕
- Quick meetings 📅
- Context switches 🔄
- "Need to check something else" moments

Examples:
  /flowforge:session:pause              # Auto-generates WIP message
  /flowforge:session:pause "WIP: auth" # Custom commit message
  /flowforge:session:pause ?           # Show this help

Options:
  [commit-message]  Optional commit message
  ?/help           Show this help
  DEBUG=1          Enable debug output

Note: Use 'pause' when you plan to return. Use '/flowforge:session:end' 
when completely done for the day.
HELP
    exit 0
fi

echo "⏸️ Pausing current work session..."

# Get current branch and extract issue number
CURRENT_BRANCH=""
if ! CURRENT_BRANCH=$(git branch --show-current 2>&1); then
    echo "❌ Not in a git repository!"
    echo "💡 Initialize with: git init"
    exit 1
fi

# Validate developer ID to prevent directory traversal and injection attacks
validate_developer_id() {
    local dev_id="$1"
    local original_id="$dev_id"

    # Remove any path traversal attempts
    dev_id="${dev_id//\.\./}"
    dev_id="${dev_id//\//}"

    # Remove special characters that could cause issues
    # Only allow alphanumeric, dash, and underscore
    dev_id=$(echo "$dev_id" | sed 's/[^a-zA-Z0-9_-]//g')

    # Log security event if ID was modified
    if [ "$original_id" != "$dev_id" ] && [ -n "${FLOWFORGE_NAMESPACE:-}" ]; then
        echo "[$(date -u +"%Y-%m-%dT%H:%M:%S.%3NZ")] SECURITY: Developer ID sanitized from '$original_id' to '$dev_id'" >> "${FLOWFORGE_NAMESPACE}/logs/security.log" 2>/dev/null || true
    fi

    # Ensure not empty
    if [ -z "$dev_id" ]; then
        dev_id="developer"
    fi

    # Truncate to reasonable length
    if [ ${#dev_id} -gt 50 ]; then
        dev_id="${dev_id:0:50}"
    fi

    echo "$dev_id"
}

# Get developer identity (multiple fallback methods)
get_developer_identity() {
    local raw_id=""

    # Priority order for identity detection
    if [ -n "${FLOWFORGE_DEV_ID:-}" ]; then
        raw_id="${FLOWFORGE_DEV_ID}"
    elif [ -n "${USER:-}" ]; then
        raw_id="${USER}"
    elif command -v whoami &> /dev/null; then
        raw_id=$(whoami)
    elif [ -n "${USERNAME:-}" ]; then
        raw_id="${USERNAME}"
    else
        # Fallback to git config
        raw_id=$(git config user.name 2>/dev/null | tr ' ' '-' | tr '[:upper:]' '[:lower:]' || echo "developer")
    fi

    # SECURITY: Validate and sanitize the developer ID
    validate_developer_id "$raw_id"
}

# Create namespace with required directories if needed
ensure_developer_namespace() {
    local dev_id=$(get_developer_identity)
    local namespace_dir=".flowforge/dev-${dev_id}"

    # Create namespace directories if they don't exist
    mkdir -p "${namespace_dir}"/sessions "${namespace_dir}"/config "${namespace_dir}"/logs 2>/dev/null || true

    # Set environment variables for session
    export FLOWFORGE_NAMESPACE="${namespace_dir}"
    export FLOWFORGE_DEV_ID="${dev_id}"

    echo "✅ Using developer namespace: dev-${dev_id}"
    return 0
}

# Setup developer namespace
ensure_developer_namespace

# Initialize variables
ISSUE_NUMBER=""
SESSION_ID=""
TASK_TITLE=""
SESSION_TIME="Unknown"

# Cache instance ID for performance optimization
get_cached_instance_id() {
    local cache_file="${FLOWFORGE_NAMESPACE}/.instance_id_cache"

    # Check if we have a cached instance ID
    if [ -f "$cache_file" ] && [ -n "${CLAUDE_INSTANCE_ID:-}" ]; then
        local cached_id=$(cat "$cache_file" 2>/dev/null || echo "")
        if [ -n "$cached_id" ]; then
            echo "$cached_id"
            return 0
        fi
    fi

    # Generate new instance ID
    local new_id="${CLAUDE_INSTANCE_ID:-${USER}@$(hostname):$$:$(date +%s)}"

    # Cache it for future use
    if [ -n "${FLOWFORGE_NAMESPACE:-}" ]; then
        echo "$new_id" > "$cache_file" 2>/dev/null || true
    fi

    echo "$new_id"
}

# Instance ID for ownership validation (cached for performance)
INSTANCE_ID=$(get_cached_instance_id)

# Check if provider bridge is available
PROVIDER_BRIDGE=""
if [ -f "./scripts/provider-bridge.js" ]; then
    PROVIDER_BRIDGE="./scripts/provider-bridge.js"
elif [ -f "./dist/scripts/provider-bridge.js" ]; then
    PROVIDER_BRIDGE="./dist/scripts/provider-bridge.js"
fi

# Load current session data from developer namespace
CURRENT_SESSION_FILE="${FLOWFORGE_NAMESPACE}/sessions/current.json"
if [ -f "$CURRENT_SESSION_FILE" ] && command -v jq &> /dev/null; then
    echo "📋 Loading current session from namespace..."
    SESSION_DATA=$(cat "$CURRENT_SESSION_FILE" 2>/dev/null || echo "{}")
    
    ISSUE_NUMBER=$(echo "$SESSION_DATA" | jq -r '.taskId // empty')
    SESSION_ID=$(echo "$SESSION_DATA" | jq -r '.sessionId // empty')
    TASK_TITLE=$(echo "$SESSION_DATA" | jq -r '.taskTitle // "Unknown"')
    START_TIME=$(echo "$SESSION_DATA" | jq -r '.startTime // empty')
    SESSION_INSTANCE_ID=$(echo "$SESSION_DATA" | jq -r '.instanceId // empty')

    # Validate instance ownership (with better concurrency handling)
    if [ -n "$SESSION_INSTANCE_ID" ] && [ "$SESSION_INSTANCE_ID" != "$INSTANCE_ID" ]; then
        # Check if the owning process is still alive (for same-machine scenarios)
        owner_pid=""
        if [[ "$SESSION_INSTANCE_ID" =~ ^.*:([0-9]+):.*$ ]]; then
            owner_pid="${BASH_REMATCH[1]}"
        fi

        owner_alive=0
        if [ -n "$owner_pid" ] && kill -0 "$owner_pid" 2>/dev/null; then
            owner_alive=1
        fi

        if [ "$owner_alive" -eq 1 ]; then
            echo "⚠️ Session owned by active process: $SESSION_INSTANCE_ID"
            echo "⚠️ Current instance: $INSTANCE_ID"
            echo "💡 Another process is using this session"
            exit 1
        else
            # Process is dead, we can take ownership
            echo "⚠️ Previous session owner no longer active, taking ownership"
            # Update the instance ID in the session file
            jq --arg instance "$INSTANCE_ID" '.instanceId = $instance' \
                "$CURRENT_SESSION_FILE" > "${CURRENT_SESSION_FILE}.tmp.$$" && \
                mv -f "${CURRENT_SESSION_FILE}.tmp.$$" "$CURRENT_SESSION_FILE"
        fi
    fi
    
    if [ -n "$ISSUE_NUMBER" ]; then
        echo "✅ Found active session for task #$ISSUE_NUMBER"
        
        # Calculate time spent if start time is available
        if [ -n "$START_TIME" ] && command -v date &> /dev/null; then
            START_EPOCH=$(date -d "$START_TIME" +%s 2>/dev/null || date -j -f "%Y-%m-%dT%H:%M:%S" "${START_TIME%.*}" +%s 2>/dev/null || echo "0")
            END_EPOCH=$(date +%s)
            if [ "$START_EPOCH" -gt 0 ]; then
                DURATION=$((END_EPOCH - START_EPOCH))
                HOURS=$((DURATION / 3600))
                MINUTES=$(((DURATION % 3600) / 60))
                SESSION_TIME="${HOURS}h ${MINUTES}m"
            fi
        fi
    fi
fi

# If no issue number from session, try to extract from branch
if [ -z "$ISSUE_NUMBER" ]; then
    ISSUE_NUMBER=$(echo "$CURRENT_BRANCH" | grep -oE '[0-9]+' | head -1 || true)
    
    if [ -z "$ISSUE_NUMBER" ]; then
        echo "⚠️ Could not detect issue number from branch: $CURRENT_BRANCH"
        
        # Try to get from active time tracking as fallback (check both locations)
        TASK_TIMES_FILE=""
        if [ -f "${FLOWFORGE_NAMESPACE}/.task-times.json" ]; then
            TASK_TIMES_FILE="${FLOWFORGE_NAMESPACE}/.task-times.json"
        elif [ -f ".task-times.json" ]; then
            TASK_TIMES_FILE=".task-times.json"
        fi

        if [ -n "$TASK_TIMES_FILE" ] && command -v jq &> /dev/null; then
            # Find active task for this instance
            ISSUE_NUMBER=$(jq -r --arg instance "$INSTANCE_ID" '
                to_entries |
                map(select(.value.status == "active" and
                          .value.current_session.instance_id == $instance)) |
                .[0].key // empty
            ' "$TASK_TIMES_FILE" 2>/dev/null || true)

            if [ -n "$ISSUE_NUMBER" ]; then
                echo "✅ Found active task #$ISSUE_NUMBER from time tracking"
            fi
        fi
        
        # If still no issue number, ask user
        if [ -z "$ISSUE_NUMBER" ]; then
            if [ -t 0 ]; then
                read -p "Enter issue number: " ISSUE_NUMBER
            else
                echo "❌ Cannot detect issue number in non-interactive mode"
                echo "💡 Use a branch with issue number (e.g., feature/123-description)"
                exit 1
            fi
        fi
    fi
fi

# Validate issue number
if ! [[ "$ISSUE_NUMBER" =~ ^[0-9]+$ ]]; then
    echo "❌ Invalid issue number: $ISSUE_NUMBER"
    exit 1
fi

echo "📍 Pausing work on issue #$ISSUE_NUMBER"

# Implement robust file locking with retry and timeout
safe_update_session() {
    local file="$1"
    local max_attempts=10
    local attempt=0
    local lock_file="${file}.lock"
    local lock_timeout=5

    # Clean up stale locks older than 60 seconds
    if [ -f "$lock_file" ]; then
        local lock_age=$(($(date +%s) - $(stat -c %Y "$lock_file" 2>/dev/null || stat -f %m "$lock_file" 2>/dev/null || echo 0)))
        if [ "$lock_age" -gt 60 ]; then
            rm -f "$lock_file" 2>/dev/null || true
            echo "⚠️ Removed stale lock (${lock_age}s old)"
        fi
    fi

    # Try to acquire lock with timeout
    while [ "$attempt" -lt "$max_attempts" ]; do
        if mkdir "$lock_file" 2>/dev/null; then
            # Lock acquired
            echo $$ > "$lock_file/pid" 2>/dev/null || true

            # Perform the update (use process-specific temp file)
            local success=0
            local tmp_file="${file}.tmp.$$"
            if jq --arg time "$CURRENT_TIME" --arg instance "$INSTANCE_ID" \
                '.pausedAt = $time | .lastActivity = $time | .instanceId = $instance' \
                "$file" > "$tmp_file" 2>/dev/null; then

                # Atomic move
                mv -f "$tmp_file" "$file" 2>/dev/null && success=1
            else
                rm -f "$tmp_file" 2>/dev/null || true
            fi

            # Release lock
            rm -rf "$lock_file" 2>/dev/null || true

            if [ "$success" -eq 1 ]; then
                return 0
            else
                echo "⚠️ Update failed, retrying..."
            fi
        fi

        # Wait before retry with exponential backoff
        sleep 0.$((100 + attempt * 50))
        ((attempt++))
    done

    # Fallback: force update without lock after timeout
    echo "⚠️ Lock timeout, performing direct update"
    local tmp_file="${file}.tmp.$$"
    jq --arg time "$CURRENT_TIME" --arg instance "$INSTANCE_ID" \
        '.pausedAt = $time | .lastActivity = $time | .instanceId = $instance' \
        "$file" > "$tmp_file" && \
        mv -f "$tmp_file" "$file"
    rm -f "$tmp_file" 2>/dev/null || true
}

# Update session data with pause time (with improved file locking)
if [ -f "$CURRENT_SESSION_FILE" ]; then
    CURRENT_TIME=$(date -u +"%Y-%m-%dT%H:%M:%S.%3NZ")

    # Use file locking if available (Node.js based)
    FILE_LOCK_SCRIPT=""
    if [ -f "./scripts/utils/file-lock-integration.js" ]; then
        FILE_LOCK_SCRIPT="./scripts/utils/file-lock-integration.js"
    elif [ -f "./scripts/utils/file-lock.js" ]; then
        FILE_LOCK_SCRIPT="./scripts/utils/file-lock.js"
    fi

    if [ -n "$FILE_LOCK_SCRIPT" ] && command -v node &> /dev/null; then
        # Use Node.js file locking for safe update
        echo "🔒 Acquiring lock for session update..."

        # Create temporary file with updated session
        TMP_SESSION="${CURRENT_SESSION_FILE}.tmp.$$"
        if jq --arg time "$CURRENT_TIME" --arg instance "$INSTANCE_ID" \
            '.pausedAt = $time | .lastActivity = $time | .instanceId = $instance' \
            "$CURRENT_SESSION_FILE" > "$TMP_SESSION" 2>/dev/null; then

            # Safely update with lock and timeout
            if timeout 5 node -e "
                const { updateWithLock } = require('$FILE_LOCK_SCRIPT');
                const fs = require('fs');
                const lockTimeout = setTimeout(() => {
                    console.error('⚠️ Lock timeout after 5 seconds');
                    process.exit(1);
                }, 5000);

                updateWithLock('$CURRENT_SESSION_FILE', async () => {
                    clearTimeout(lockTimeout);
                    const content = fs.readFileSync('$TMP_SESSION', 'utf8');
                    return JSON.parse(content);
                }).then(() => {
                    console.log('✅ Session updated with lock');
                    process.exit(0);
                }).catch(err => {
                    console.error('⚠️ Lock update failed:', err.message);
                    // Fallback to direct update
                    try {
                        fs.copyFileSync('$TMP_SESSION', '$CURRENT_SESSION_FILE');
                        console.log('✅ Session updated directly');
                    } catch (e) {
                        console.error('❌ Failed to update session:', e.message);
                        process.exit(1);
                    }
                });
            " 2>&1; then
                rm -f "$TMP_SESSION" 2>/dev/null
            else
                # Node.js locking failed, use shell-based locking
                echo "⚠️ Node.js locking failed, using shell-based locking"
                safe_update_session "$CURRENT_SESSION_FILE"
                rm -f "$TMP_SESSION" 2>/dev/null
            fi
        else
            echo "⚠️ Failed to prepare session update"
        fi
    else
        # Use shell-based file locking
        safe_update_session "$CURRENT_SESSION_FILE"
    fi

    echo "💾 Session state saved to namespace"
fi

# Pause time tracking (not stop!) with file locking
echo "⏱️ Pausing time tracking..."

# Find time tracking script
TIME_SCRIPT=""
if [ -f "./scripts/task-time.sh" ]; then
    TIME_SCRIPT="./scripts/task-time.sh"
elif [ -f "./.flowforge/scripts/task-time.sh" ]; then
    TIME_SCRIPT="./.flowforge/scripts/task-time.sh"
fi

if [ -n "$TIME_SCRIPT" ]; then
    # Export instance ID for task-time.sh to use
    export CLAUDE_INSTANCE_ID="$INSTANCE_ID"
    export FLOWFORGE_NAMESPACE="$FLOWFORGE_NAMESPACE"

    # Pause with a reason
    PAUSE_REASON="${ARGUMENTS:-Quick pause}"
    if "$TIME_SCRIPT" pause "$ISSUE_NUMBER" "$PAUSE_REASON" 2>&1; then
        echo "✅ Time tracking paused"
        
        # Get session summary
        echo -e "\n📊 Session Summary:"
        if STATUS_OUTPUT=$("$TIME_SCRIPT" status "$ISSUE_NUMBER" 2>&1); then
            echo "$STATUS_OUTPUT"
            # Extract time for GitHub comment
            SESSION_TIME=$(echo "$STATUS_OUTPUT" | grep -E "Total Time:|Total time:" | cut -d: -f2- | xargs || echo "Unknown")
        else
            echo "⚠️  Could not get time status"
        fi
    else
        echo "⚠️  Could not pause time tracking (continuing anyway)"
    fi
else
    echo "⚠️  Time tracking script not found"
fi

# Update task status in provider
if [ -n "$PROVIDER_BRIDGE" ] && command -v node &> /dev/null; then
    echo -e "\n📋 Updating task status..."
    if node "$PROVIDER_BRIDGE" update-task --id="$ISSUE_NUMBER" --status=paused 2>&1; then
        echo "✅ Task status updated to paused"
    else
        echo "⚠️  Could not update task status"
    fi
fi

# Check for uncommitted changes
if [[ -n $(git status --porcelain 2>/dev/null || echo "error") ]]; then
    echo -e "\n📝 Uncommitted changes found:"
    git status --short 2>/dev/null | head -10
    
    echo -e "\n💾 Committing changes..."
    
    # Stage all changes
    if ! git add -A 2>&1; then
        echo "⚠️  Could not stage changes"
        echo "💡 Check file permissions and .gitignore"
    else
        # Use provided message or generate one
        if [ -n "${ARGUMENTS:-}" ] && [ "${ARGUMENTS}" != "Quick pause" ]; then
            COMMIT_MSG="$ARGUMENTS"
        else
            COMMIT_MSG="wip: work in progress on issue #$ISSUE_NUMBER"
        fi
        
        # Commit changes
        if git commit -m "$COMMIT_MSG" 2>&1; then
            echo "✅ Changes committed"
        else
            echo "⚠️  Could not commit (maybe no changes?)"
        fi
    fi
else
    echo "✅ No uncommitted changes"
fi

# Push changes
echo -e "\n📤 Pushing changes..."
if git remote get-url origin &>/dev/null; then
    if git push origin "$CURRENT_BRANCH" 2>&1; then
        echo "✅ Changes pushed to remote"
    else
        echo "⚠️  Could not push changes"
        echo "💡 You may need to push manually later"
        echo "   Run: git push -u origin $CURRENT_BRANCH"
    fi
else
    echo "⚠️  No remote 'origin' configured"
    echo "💡 Add remote with: git remote add origin <url>"
fi

# Update issue with progress (if gh is available)
if command -v gh &> /dev/null && [ -n "$ISSUE_NUMBER" ]; then
    echo -e "\n📋 Updating GitHub issue..."
    
    # Create comment body
    COMMENT_BODY="## 🔄 Work Session Paused

**Time Spent**: $SESSION_TIME
**Branch**: \`$CURRENT_BRANCH\`
**Status**: Taking a break - work in progress

Session paused with /flowforge:session:pause"

    if gh issue comment "$ISSUE_NUMBER" --body "$COMMENT_BODY" 2>&1; then
        echo "✅ GitHub issue updated"
    else
        echo "⚠️  Could not update GitHub issue"
        echo "💡 Check your GitHub authentication: gh auth status"
    fi
else
    [ -z "$ISSUE_NUMBER" ] || echo "⚠️  GitHub CLI not available - skipping issue update"
fi

# Save context before pausing (using namespace)
if [ -f "scripts/context-preservation.sh" ] && [ -n "$ISSUE_NUMBER" ]; then
    echo -e "\n📍 Preserving context for quick resume..."

    # Get modified files from git status
    MODIFIED_FILES=$(git status --short 2>/dev/null | grep -E "^[ M]M" | awk '{print $2}' | head -5 | tr '\n' ',' | sed 's/,$//')

    # Add line numbers (placeholder for now)
    if [ -n "$MODIFIED_FILES" ]; then
        CURRENT_FILES=$(echo "$MODIFIED_FILES" | sed 's/[^,]*/&:1/g')
    else
        CURRENT_FILES=""
    fi

    # Save context with namespace awareness
    export FLOWFORGE_ISSUE="$ISSUE_NUMBER"
    export FLOWFORGE_LAST_ACTION="Paused: ${PAUSE_REASON:-Taking a break}"
    export FLOWFORGE_CURRENT_FILES="$CURRENT_FILES"
    export FLOWFORGE_LAST_DIFF="$(git diff --stat 2>/dev/null | head -5)"
    export FLOWFORGE_NAMESPACE="$FLOWFORGE_NAMESPACE"
    export FLOWFORGE_DEV_ID="$FLOWFORGE_DEV_ID"

    ./scripts/context-preservation.sh save > /dev/null 2>&1
    echo "✅ Context saved for quick resume in namespace"
fi

# Save position for seamless resume (using namespace)
if [ -f "scripts/position-tracker.sh" ] && [ -n "$ISSUE_NUMBER" ]; then
    export FLOWFORGE_NAMESPACE="$FLOWFORGE_NAMESPACE"
    export FLOWFORGE_DEV_ID="$FLOWFORGE_DEV_ID"
    ./scripts/position-tracker.sh save "$ISSUE_NUMBER" "" "Session paused" "Paused: ${PAUSE_REASON:-Taking a break}"
fi

# Success message
echo -e "\n✅ Work session paused successfully!"
echo ""
echo "📌 Current state:"
echo "   • Issue: #$ISSUE_NUMBER"
echo "   • Branch: $CURRENT_BRANCH"
echo "   • Time: $SESSION_TIME"
echo "   • Developer: $FLOWFORGE_DEV_ID"
echo "   • Namespace: $(basename "$FLOWFORGE_NAMESPACE")"
echo ""
echo "💡 To resume work:"
echo "   /flowforge:session:start $ISSUE_NUMBER"
echo ""
echo "💡 Or if switching tasks:"
echo "   /flowforge:session:start [other-issue]"

# Exit successfully
exit 0
```