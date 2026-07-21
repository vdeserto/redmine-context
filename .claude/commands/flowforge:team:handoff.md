# Command: flowforge:team:handoff
# Version: 2.0.0
# Description: Handoff task to another developer
# Issue: #548 - Git-Integrated Namespace System

---
description: Transfer task ownership to another developer
---

# 🤝 Task Handoff

## 🔧 Setup
```bash
# Enable strict error handling
set -euo pipefail

# Configuration
FLOWFORGE_ROOT="${FLOWFORGE_ROOT_OVERRIDE:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)/.flowforge}"
ARGS=($ARGUMENTS)
TASK_ID="${ARGS[0]:-}"
NEW_DEVELOPER="${ARGS[1]:-}"
CURRENT_DEVELOPER="${FLOWFORGE_DEVELOPER_ID:-$(whoami)}"

if [[ -z "$TASK_ID" ]] || [[ -z "$NEW_DEVELOPER" ]]; then
    echo "Usage: /flowforge:team:handoff <task-id> <developer-id>"
    exit 1
fi
```

## 📊 Main Execution
```bash
echo "🤝 Handing off task $TASK_ID to $NEW_DEVELOPER..."

ASSIGNMENTS_FILE="$FLOWFORGE_ROOT/team/task-assignments.json"

# Create assignments file if it doesn't exist
if [[ ! -f "$ASSIGNMENTS_FILE" ]]; then
    echo '{ "assignments": {}, "history": [] }' > "$ASSIGNMENTS_FILE"
fi

# Update task assignment
TEMP_FILE=$(mktemp)
jq --arg task "$TASK_ID" \
   --arg old_dev "$CURRENT_DEVELOPER" \
   --arg new_dev "$NEW_DEVELOPER" \
   --arg time "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" \
   '# Update assignment
    .assignments[$task] = {
        "developer": $new_dev,
        "claimed_at": $time,
        "status": "handed_off",
        "previous_owner": $old_dev
    } |
    # Add to history
    .history += [{
        "task": $task,
        "action": "handoff",
        "from": $old_dev,
        "to": $new_dev,
        "timestamp": $time
    }]' \
   "$ASSIGNMENTS_FILE" > "$TEMP_FILE"

mv "$TEMP_FILE" "$ASSIGNMENTS_FILE"

echo "✅ Task $TASK_ID handed off from $CURRENT_DEVELOPER to $NEW_DEVELOPER"
echo "Time: $(date -u +"%Y-%m-%d %H:%M:%S UTC")"

# Send notification message
if command -v flowforge:team:message &>/dev/null; then
    flowforge:team:message "Task $TASK_ID handed off from $CURRENT_DEVELOPER to $NEW_DEVELOPER" 2>/dev/null || true
fi

# Trigger sync
if [[ -f "./scripts/namespace/git-sync.sh" ]]; then
    bash ./scripts/namespace/git-sync.sh sync 2>/dev/null || true
fi
```

## 🎯 Success Output
```bash
echo "✅ Task handoff complete"
```