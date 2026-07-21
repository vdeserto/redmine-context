# Command: flowforge:session:restore
# Version: 2.0.0
# Description: Restore session from Git-tracked namespace data
# Issue: #548 - Git-Integrated Namespace System

---
description: Restore a previous session from Git history or cross-machine sync
---

# 🔄 FlowForge Session Restore

## 🔧 Setup Error Handling
```bash
# Enable strict error handling
set -euo pipefail

# Error handler function
handle_error() {
    local exit_code=$?
    local line_number=$1
    echo "❌ Error on line $line_number (exit code: $exit_code)"

    # Provide helpful error messages
    if [[ "${BASH_COMMAND:-}" =~ "git" ]]; then
        echo "💡 Git command failed - ensure repository is synced"
    elif [[ "${BASH_COMMAND:-}" =~ "jq" ]]; then
        echo "💡 Session data parsing failed - check JSON format"
    fi

    exit $exit_code
}

# Set error trap
trap 'handle_error $LINENO' ERR

# Enable debug mode if DEBUG=1
[[ "${DEBUG:-0}" == "1" ]] && set -x
```

## 📚 Show Help
```bash
# Check if help is requested
if [[ "${ARGUMENTS:-}" == "?" || "${ARGUMENTS:-}" == "help" ]]; then
    cat << 'EOF'
🔄 FlowForge Session Restore

Restore a session from Git history or sync from another machine.

Usage: /flowforge:session:restore [session-id|options]

Arguments:
  session-id     Restore specific session by ID
  latest         Restore most recent session
  list           List available sessions to restore

Options:
  --from-machine MACHINE  Restore from specific machine
  --date DATE            Restore session from specific date
  --task TASK-ID         Restore last session for task
  help, ?                Show this help message

Features:
  • Cross-machine session continuity
  • Git-based session history
  • Automatic conflict resolution
  • Environment restoration

Examples:
  /flowforge:session:restore latest              # Restore last session
  /flowforge:session:restore list                # Show available sessions
  /flowforge:session:restore session-123456      # Restore specific session
  /flowforge:session:restore --task issue-42     # Restore session for task
  /flowforge:session:restore --from-machine work # Restore from work machine

Related commands:
  /flowforge:session:start    Start new session
  /flowforge:namespace:sync   Sync namespace data

EOF
    exit 0
fi
```

## 🔍 Parse Options
```bash
# Initialize options
SESSION_ID=""
RESTORE_MODE="specific"
FROM_MACHINE=""
TARGET_DATE=""
TASK_ID=""

# Parse arguments
ARGS=($ARGUMENTS)
ARG_COUNT=0

for arg in ${ARGUMENTS:-}; do
    case "$arg" in
        latest)
            RESTORE_MODE="latest"
            ;;

        list)
            RESTORE_MODE="list"
            ;;

        --from-machine)
            FROM_MACHINE="${ARGS[$((ARG_COUNT + 1))]:-}"
            ;;

        --date)
            TARGET_DATE="${ARGS[$((ARG_COUNT + 1))]:-}"
            ;;

        --task)
            TASK_ID="${ARGS[$((ARG_COUNT + 1))]:-}"
            RESTORE_MODE="task"
            ;;

        --*)
            if [[ ! "$arg" =~ ^--(from-machine|date|task) ]]; then
                echo "⚠️  Unknown option: $arg"
            fi
            ;;

        *)
            # Assume it's a session ID if not an option
            if [[ ! "$arg" =~ ^-- ]] && [[ "$ARG_COUNT" -eq 0 ]]; then
                SESSION_ID="$arg"
                RESTORE_MODE="specific"
            fi
            ;;
    esac
    ARG_COUNT=$((ARG_COUNT + 1))
done
```

## 🛠️ Setup Paths and Scripts
```bash
# Get project root and paths
PROJECT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
FLOWFORGE_ROOT="${FLOWFORGE_ROOT_OVERRIDE:-$PROJECT_ROOT}/.flowforge"
DEVELOPER_ID="${FLOWFORGE_DEVELOPER_ID:-$(whoami)}"

# Locate session integration script
SESSION_SCRIPT=""
for location in \
    "$PROJECT_ROOT/scripts/namespace/session-integration.sh" \
    "$(dirname "$0")/../../../scripts/namespace/session-integration.sh"; do
    if [[ -f "$location" ]]; then
        SESSION_SCRIPT="$location"
        break
    fi
done

if [[ -z "$SESSION_SCRIPT" ]]; then
    echo "❌ Error: session-integration.sh not found"
    exit 1
fi

# Source session functions
source "$SESSION_SCRIPT"
```

## 🔍 List Available Sessions
```bash
list_available_sessions() {
    echo "📋 Available Sessions to Restore"
    echo "================================"
    echo ""

    local count=0

    # Search in developer namespace
    local dev_dir="$FLOWFORGE_ROOT/developers/$DEVELOPER_ID"

    if [[ -d "$dev_dir/sessions/history" ]]; then
        echo "📂 Your sessions ($DEVELOPER_ID):"
        echo "-----------------------------------"

        for session_file in $(ls -t "$dev_dir/sessions/history/"*.json 2>/dev/null | head -20); do
            if [[ -f "$session_file" ]]; then
                local session_id=$(jq -r '.session_id // "unknown"' "$session_file")
                local task_id=$(jq -r '.task // .taskId // "no-task"' "$session_file")
                local started=$(jq -r '.started_at // .startTime // "unknown"' "$session_file")
                local ended=$(jq -r '.ended_at // .endTime // "in-progress"' "$session_file")

                echo "  • $session_id"
                echo "    Task: $task_id"
                echo "    Started: $started"
                echo "    Ended: $ended"
                echo ""

                count=$((count + 1))
            fi
        done

        if [[ $count -eq 0 ]]; then
            echo "  No sessions found in history"
        fi
    fi

    # Check for sessions from other machines (if Git synced)
    if [[ -d "$FLOWFORGE_ROOT/developers" ]]; then
        echo ""
        echo "📂 Sessions from other machines:"
        echo "-----------------------------------"

        for other_dev_dir in "$FLOWFORGE_ROOT/developers/"*/; do
            local other_dev=$(basename "$other_dev_dir")

            if [[ "$other_dev" != "$DEVELOPER_ID" ]] && [[ -d "$other_dev_dir/sessions/history" ]]; then
                echo ""
                echo "  Machine: $other_dev"

                local other_count=0
                for session_file in $(ls -t "$other_dev_dir/sessions/history/"*.json 2>/dev/null | head -5); do
                    if [[ -f "$session_file" ]]; then
                        local session_id=$(jq -r '.session_id // "unknown"' "$session_file")
                        local task_id=$(jq -r '.task // .taskId // "no-task"' "$session_file")

                        echo "    • $session_id (Task: $task_id)"
                        other_count=$((other_count + 1))
                    fi
                done

                if [[ $other_count -eq 0 ]]; then
                    echo "    No sessions found"
                fi
            fi
        done
    fi

    echo ""
    echo "💡 To restore: /flowforge:session:restore <session-id>"
}
```

## 🔄 Restore Session Function
```bash
restore_session() {
    local session_to_restore="$1"
    local session_file=""

    echo "🔄 Restoring session: $session_to_restore"
    echo "========================================"

    # Search for session file
    # First check local developer namespace
    local dev_dir="$FLOWFORGE_ROOT/developers/$DEVELOPER_ID"

    if [[ -f "$dev_dir/sessions/history/${session_to_restore}.json" ]]; then
        session_file="$dev_dir/sessions/history/${session_to_restore}.json"
    else
        # Search across all developers
        for search_dir in "$FLOWFORGE_ROOT/developers/"*/sessions/history/; do
            if [[ -f "$search_dir/${session_to_restore}.json" ]]; then
                session_file="$search_dir/${session_to_restore}.json"
                break
            fi
        done
    fi

    # Check if session file found
    if [[ -z "$session_file" ]] || [[ ! -f "$session_file" ]]; then
        echo "❌ Session not found: $session_to_restore"
        echo "💡 Use '/flowforge:session:restore list' to see available sessions"
        return 1
    fi

    echo "✅ Found session in: $(dirname "$session_file")"

    # Extract session data
    local task_id=$(jq -r '.task // .taskId // ""' "$session_file")
    local branch=$(jq -r '.environment.gitBranch // ""' "$session_file")
    local commit=$(jq -r '.environment.gitCommit // ""' "$session_file")

    # Display session info
    echo ""
    echo "📋 Session Details:"
    echo "  • Session ID: $session_to_restore"
    echo "  • Task: ${task_id:-none}"
    echo "  • Branch: ${branch:-unknown}"
    echo "  • Commit: ${commit:-unknown}"

    # Restore git branch if different
    if [[ -n "$branch" ]] && [[ "$branch" != "unknown" ]]; then
        current_branch=$(git branch --show-current 2>/dev/null || echo "")

        if [[ "$current_branch" != "$branch" ]]; then
            echo ""
            echo "🌿 Switching to branch: $branch"

            if git show-ref --verify --quiet "refs/heads/$branch"; then
                git checkout "$branch"
                echo "✅ Switched to branch: $branch"
            else
                echo "⚠️  Branch not found locally: $branch"
                echo "💡 You may need to fetch from remote"
            fi
        fi
    fi

    # Create new session with restored data
    local current_session_file=$(get_session_file_with_namespace)
    local new_session_id="restored-$(date +%s)-$$"

    # Create restored session
    cat > "$current_session_file" << EOF
{
    "active": true,
    "sessionId": "$new_session_id",
    "startTime": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
    "taskId": "$task_id",
    "developerId": "$DEVELOPER_ID",
    "restoredFrom": "$session_to_restore",
    "environment": {
        "gitBranch": "$(git branch --show-current 2>/dev/null || echo "$branch")",
        "gitCommit": "$(git rev-parse HEAD 2>/dev/null || echo "$commit")",
        "projectRoot": "$PROJECT_ROOT"
    }
}
EOF

    echo ""
    echo "✅ Session restored successfully!"
    echo "📝 New session ID: $new_session_id"
    echo "🎯 Working on: ${task_id:-no specific task}"

    # Start time tracking if task provided
    if [[ -n "$task_id" ]] && [[ "$task_id" != "null" ]]; then
        if [[ -f "$PROJECT_ROOT/scripts/task-time.sh" ]]; then
            echo ""
            echo "⏱️  Starting time tracking for task: $task_id"
            "$PROJECT_ROOT/scripts/task-time.sh" start "$task_id" >/dev/null 2>&1 || true
        fi
    fi

    return 0
}
```

## 🔄 Find Latest Session
```bash
find_latest_session() {
    local search_dir="${1:-$FLOWFORGE_ROOT/developers/$DEVELOPER_ID}"

    if [[ -d "$search_dir/sessions/history" ]]; then
        local latest=$(ls -t "$search_dir/sessions/history/"*.json 2>/dev/null | head -1)

        if [[ -f "$latest" ]]; then
            basename "$latest" .json
        fi
    fi
}
```

## 🔍 Find Session by Task
```bash
find_session_by_task() {
    local task="$1"
    local found_session=""

    # Search in all session histories
    for dev_dir in "$FLOWFORGE_ROOT/developers/"*/; do
        if [[ -d "$dev_dir/sessions/history" ]]; then
            for session_file in "$dev_dir/sessions/history/"*.json; do
                if [[ -f "$session_file" ]]; then
                    local session_task=$(jq -r '.task // .taskId // ""' "$session_file")

                    if [[ "$session_task" == "$task" ]]; then
                        found_session=$(basename "$session_file" .json)
                        break 2
                    fi
                fi
            done
        fi
    done

    echo "$found_session"
}
```

## 📊 Main Execution
```bash
# Main execution based on mode
case "$RESTORE_MODE" in
    list)
        list_available_sessions
        ;;

    latest)
        echo "🔍 Finding latest session..."

        latest_session=$(find_latest_session)

        if [[ -n "$latest_session" ]]; then
            restore_session "$latest_session"
        else
            echo "❌ No sessions found to restore"
            exit 1
        fi
        ;;

    task)
        if [[ -z "$TASK_ID" ]]; then
            echo "❌ Task ID required"
            exit 1
        fi

        echo "🔍 Finding session for task: $TASK_ID"

        task_session=$(find_session_by_task "$TASK_ID")

        if [[ -n "$task_session" ]]; then
            restore_session "$task_session"
        else
            echo "❌ No session found for task: $TASK_ID"
            exit 1
        fi
        ;;

    specific)
        if [[ -z "$SESSION_ID" ]]; then
            echo "❌ Session ID required"
            echo "💡 Use '/flowforge:session:restore list' to see available sessions"
            exit 1
        fi

        restore_session "$SESSION_ID"
        ;;

    *)
        echo "❌ Unknown restore mode: $RESTORE_MODE"
        exit 1
        ;;
esac
```

## 📋 Exit
```bash
exit 0
```