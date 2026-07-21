# Command: flowforge:context:restore
# Version: 2.0.0
# Description: Restore complete development context from Git
# Issue: #548 - Git-Integrated Namespace System

---
description: Restore session, branch, and task context from Git for cross-machine synchronization
---

# 🔄 Context Restoration

## 🔧 Setup
```bash
# Enable strict error handling
set -euo pipefail

# Configuration
PROJECT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
FLOWFORGE_ROOT="${FLOWFORGE_ROOT_OVERRIDE:-$PROJECT_ROOT}/.flowforge"
DEVELOPER="${FLOWFORGE_DEVELOPER_ID:-$(whoami)}"
MACHINE_ID="${MACHINE_ID:-$(hostname)}"
```

## 📊 Main Execution
```bash
echo "🔄 Restoring Complete Development Context"
echo "════════════════════════════════════════════════════════════════"
echo "Developer: $DEVELOPER"
echo "Machine: $MACHINE_ID"
echo ""

# Check for session restore script
if [[ -f "$PROJECT_ROOT/scripts/namespace/session-restore.sh" ]]; then
    echo "📦 Using namespace session restore..."
    bash "$PROJECT_ROOT/scripts/namespace/session-restore.sh" context
else
    echo "⚠️  Session restore script not found"
    
    # Fallback: Basic context restoration
    echo "📂 Performing basic context restoration..."
    
    # Pull latest from Git
    echo "📥 Fetching latest changes..."
    git fetch --quiet 2>/dev/null || echo "⚠️  Could not fetch from remote"
    
    # Check for existing session
    SESSION_FILE="$FLOWFORGE_ROOT/developers/$DEVELOPER/sessions/current/session.json"
    
    if [[ -f "$SESSION_FILE" ]]; then
        echo "📄 Found existing session"
        
        # Extract session info
        SESSION_ID=$(jq -r '.session_id // "unknown"' "$SESSION_FILE" 2>/dev/null)
        BRANCH=$(jq -r '.branch // ""' "$SESSION_FILE" 2>/dev/null)
        TASK=$(jq -r '.task_id // ""' "$SESSION_FILE" 2>/dev/null)
        
        echo "  Session: $SESSION_ID"
        echo "  Branch: $BRANCH"
        echo "  Task: $TASK"
        
        # Restore branch if different
        if [[ -n "$BRANCH" ]] && [[ "$BRANCH" != "null" ]]; then
            CURRENT_BRANCH=$(git branch --show-current)
            if [[ "$CURRENT_BRANCH" != "$BRANCH" ]]; then
                echo "🌿 Switching to branch: $BRANCH"
                git checkout "$BRANCH" 2>/dev/null || echo "⚠️  Could not switch to $BRANCH"
            fi
        fi
    else
        echo "ℹ️  No previous session found"
        echo "   Start a new session with: /flowforge:session:start"
    fi
fi

echo ""
echo "════════════════════════════════════════════════════════════════"
```

## 🎯 Success Output
```bash
echo "✅ Context restoration complete"
echo ""
echo "Next steps:"
echo "  • Review restored session: /flowforge:session:status"
echo "  • Continue work: /flowforge:session:resume"
echo "  • Start new task: /flowforge:session:start <task-id>"
```