# Command: flowforge:team:blocked
# Version: 2.0.0
# Description: Report a blocker on a task
# Issue: #548 - Git-Integrated Namespace System

---
description: Report and track blockers on tasks
---

# 🚫 Blocker Notification

## 🔧 Setup
```bash
# Enable strict error handling
set -euo pipefail

# Configuration
FLOWFORGE_ROOT="${FLOWFORGE_ROOT_OVERRIDE:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)/.flowforge}"
ARGS=($ARGUMENTS)
TASK_ID="${ARGS[0]:-}"
BLOCKER_REASON="${ARGS[@]:1}"
DEVELOPER="${FLOWFORGE_DEVELOPER_ID:-$(whoami)}"

if [[ -z "$TASK_ID" ]] || [[ -z "$BLOCKER_REASON" ]]; then
    echo "Usage: /flowforge:team:blocked <task-id> <reason>"
    exit 1
fi
```

## 📊 Main Execution
```bash
echo "🚫 Reporting blocker on task $TASK_ID..."

BLOCKERS_FILE="$FLOWFORGE_ROOT/team/blockers.json"

# Create blockers file if it doesn't exist
if [[ ! -f "$BLOCKERS_FILE" ]]; then
    echo '{ "blockers": [], "history": [] }' > "$BLOCKERS_FILE"
fi

# Add blocker
TEMP_FILE=$(mktemp)
jq --arg task "$TASK_ID" \
   --arg dev "$DEVELOPER" \
   --arg reason "$BLOCKER_REASON" \
   --arg time "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" \
   '# Add active blocker
    .blockers = (.blockers | map(select(.task != $task))) + [{
        "task": $task,
        "developer": $dev,
        "reason": $reason,
        "reported_at": $time,
        "status": "active"
    }] |
    # Add to history
    .history += [{
        "task": $task,
        "action": "blocked",
        "developer": $dev,
        "reason": $reason,
        "timestamp": $time
    }]' \
   "$BLOCKERS_FILE" > "$TEMP_FILE"

mv "$TEMP_FILE" "$BLOCKERS_FILE"

echo "✅ Blocker reported for task $TASK_ID"
echo "Reporter: $DEVELOPER"
echo "Reason: $BLOCKER_REASON"
echo "Time: $(date -u +"%Y-%m-%d %H:%M:%S UTC")"

# Send team message about blocker
if command -v flowforge:team:message &>/dev/null; then
    flowforge:team:message "🚫 BLOCKED: Task $TASK_ID - $BLOCKER_REASON (reported by $DEVELOPER)" 2>/dev/null || true
fi

# Update task status
ASSIGNMENTS_FILE="$FLOWFORGE_ROOT/team/task-assignments.json"
if [[ -f "$ASSIGNMENTS_FILE" ]]; then
    TEMP_FILE=$(mktemp)
    jq --arg task "$TASK_ID" '.assignments[$task].status = "blocked"' "$ASSIGNMENTS_FILE" > "$TEMP_FILE"
    mv "$TEMP_FILE" "$ASSIGNMENTS_FILE"
fi

# Trigger sync
if [[ -f "./scripts/namespace/git-sync.sh" ]]; then
    bash ./scripts/namespace/git-sync.sh sync 2>/dev/null || true
fi
```

## 🎯 Success Output
```bash
echo "✅ Blocker notification sent"
```