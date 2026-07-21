# Command: flowforge:team:tasks
# Version: 2.0.0
# Description: Show team task assignments
# Issue: #548 - Git-Integrated Namespace System

---
description: Display current task assignments across the team
---

# 📋 Team Task Assignments

## 🔧 Setup
```bash
# Enable strict error handling
set -euo pipefail

# Configuration
FLOWFORGE_ROOT="${FLOWFORGE_ROOT_OVERRIDE:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)/.flowforge}"
FILTER="${ARGUMENTS:-}"
```

## 📊 Main Execution
```bash
echo "📋 Team Task Assignments"
echo "════════════════════════════════════════════════════════════════"

ASSIGNMENTS_FILE="$FLOWFORGE_ROOT/team/task-assignments.json"

if [[ -f "$ASSIGNMENTS_FILE" ]]; then
    # Show all assignments or filter
    if [[ -z "$FILTER" ]]; then
        # Show all assignments - read from the test's actual structure
        # Test creates: {"task-548": {"assignee": "dev1",...}, "task-549": {...}}
        jq -r 'to_entries[] | "\(.value.assignee // "unassigned"): Task #\(.key | gsub("task-"; "")) [\(.value.status // "in_progress")]"' "$ASSIGNMENTS_FILE" 2>/dev/null || echo "No assignments found"
    else
        # Apply filter
        if [[ "$FILTER" =~ developer= ]]; then
            # Filter by developer
            dev_filter="${FILTER#developer=}"
            jq -r --arg dev "$dev_filter" 'to_entries[] | select(.value.assignee == $dev) | "\(.value.assignee): \(.key | gsub("task-"; "")) [\(.value.status // "in_progress")]"' "$ASSIGNMENTS_FILE" 2>/dev/null || echo "No tasks for $dev_filter"
        else
            # Show task info
            task_id="task-$FILTER"
            jq -r --arg task "$task_id" '.[$task] // {assignee: "unassigned"} | "\(.assignee): \($task | gsub("task-"; "")) [\(.status // "unknown")]"' "$ASSIGNMENTS_FILE" 2>/dev/null || echo "Task not found: $FILTER"
        fi
    fi
else
    echo "No task assignments file found"
fi

echo "════════════════════════════════════════════════════════════════"
```

## 🎯 Success Output
```bash
echo "✅ Task assignments displayed"
```