# Command: flowforge:session:nextTask
# Version: 2.0.0
# Description: FlowForge session nextTask command

---
description: Seamlessly transition to the next task without interruption
argument-hint: "[--auto] (auto-confirm transition)"
---

# 🚀 Next Task - Seamless Work Transition

## 🎯 Purpose
Enable continuous workflow by:
- Showing current task completion status
- Displaying next task with full context
- Seamlessly transitioning without mental overhead
- Maintaining time tracking continuity
- Preparing all files for next work

## 📋 Pre-flight Checks
```bash
set -euo pipefail

# Error handler
handle_error() {
    local exit_code=$?
    echo "❌ Error on line $1 (exit code: $exit_code)"
    exit $exit_code
}
trap 'handle_error $LINENO' ERR

# Check for help
if [[ "${ARGUMENTS:-}" == "?" || "${ARGUMENTS:-}" == "help" ]]; then
    cat << 'HELP'
🚀 FlowForge Next Task - Seamless Transitions

Usage: /ff:nextTask [options]

What it does:
✓ Shows current microtask/task status
✓ Identifies next work item intelligently
✓ Displays time estimates and context
✓ Transitions smoothly with confirmation
✓ Updates all tracking files
✓ Starts timer for new work
✓ Shows implementation hints

Options:
  --auto     Skip confirmation, auto-transition
  --preview  Only show what's next, don't transition
  ?/help     Show this help

Examples:
  /ff:nextTask              # Show next and confirm
  /ff:nextTask --auto       # Auto-transition
  /ff:nextTask --preview    # Just peek at what's next

After running:
- Current work properly closed/paused
- Next task timer started
- All files updated
- Ready to code immediately!
HELP
    exit 0
fi

# Parse options
AUTO_MODE=false
PREVIEW_MODE=false
if [[ "${ARGUMENTS:-}" == "--auto" ]]; then
    AUTO_MODE=true
elif [[ "${ARGUMENTS:-}" == "--preview" ]]; then
    PREVIEW_MODE=true
fi

echo "🚀 Preparing next task transition..."
```

## 🔍 Step 1: Analyze Current State
```bash
# Source utilities
if [ -f "./scripts/utils/format-time.sh" ]; then
    source "./scripts/utils/format-time.sh"
fi

# Get current work status
CURRENT_TASK=""
CURRENT_MICROTASK=""
CURRENT_TIME=0
CURRENT_ESTIMATE=0

# Check microtask tracking (FlowForge 2.0)
if [ -f ".flowforge/microtask-times.json" ]; then
    # Find active microtask
    ACTIVE_MT=$(jq -r '
        to_entries | 
        map(.value.microtasks | to_entries | 
            map(select(.value.status == "in_progress")) | 
            .[]) | 
        .[0] // null
    ' .flowforge/microtask-times.json 2>/dev/null)
    
    if [ "$ACTIVE_MT" != "null" ] && [ -n "$ACTIVE_MT" ]; then
        CURRENT_TASK=$(echo "$ACTIVE_MT" | jq -r '.key' | cut -d. -f1)
        CURRENT_MICROTASK=$(echo "$ACTIVE_MT" | jq -r '.key')
        CURRENT_TIME=$(echo "$ACTIVE_MT" | jq -r '.value.actual_hours // 0')
        CURRENT_ESTIMATE=$(echo "$ACTIVE_MT" | jq -r '.value.estimate_hours // 0.1')
    fi
else
    # Fallback to issue-level tracking
    if [ -f ".task-times.json" ]; then
        CURRENT_TASK=$(jq -r '
            to_entries | 
            map(select(.value.status == "active")) | 
            .[0].key // ""
        ' .task-times.json 2>/dev/null)
    fi
fi

# Display current status
if [ -n "$CURRENT_MICROTASK" ]; then
    PERCENT=$(awk "BEGIN {printf \"%.0f\", ($CURRENT_TIME / $CURRENT_ESTIMATE) * 100}")
    echo "📍 Current: $CURRENT_MICROTASK"
    echo "   Progress: $PERCENT% complete"
    echo "   Time: $(format_time $CURRENT_TIME) of $(format_time $CURRENT_ESTIMATE)"
elif [ -n "$CURRENT_TASK" ]; then
    echo "📍 Current: Issue #$CURRENT_TASK (no microtask tracking)"
else
    echo "ℹ️  No active task detected"
fi
```

## 🎯 Step 2: Identify Next Task
```bash
# Smart detection of next work
NEXT_TASK=""
NEXT_MICROTASK=""
NEXT_DESCRIPTION=""
NEXT_ESTIMATE=0
NEXT_CONTEXT=""

# Priority order for finding next work:
# 1. Next microtask in current issue
# 2. First microtask of next issue in tasks.json
# 3. Next issue from milestones in tasks.json
# 4. Assigned GitHub issues

echo -e "\n🔍 Finding next task..."

# Check for next microtask in current issue
if [ -n "$CURRENT_TASK" ] && [ -f ".flowforge/microtask-times.json" ]; then
    NEXT_MT=$(jq -r --arg task "$CURRENT_TASK" '
        .[$task].microtasks | 
        to_entries | 
        map(select(.value.status == "pending")) | 
        .[0] // null
    ' .flowforge/microtask-times.json 2>/dev/null)
    
    if [ "$NEXT_MT" != "null" ] && [ -n "$NEXT_MT" ]; then
        NEXT_TASK=$CURRENT_TASK
        NEXT_MICROTASK=$(echo "$NEXT_MT" | jq -r '.key')
        NEXT_DESCRIPTION=$(echo "$NEXT_MT" | jq -r '.value.description')
        NEXT_ESTIMATE=$(echo "$NEXT_MT" | jq -r '.value.estimate_hours // 0.1')
        NEXT_CONTEXT="Continue current issue"
    fi
fi

# If no microtask, check tasks.json for next issue
if [ -z "$NEXT_TASK" ]; then
    # Use provider-bridge to find next high-priority task
    NEXT_ISSUE=$(node scripts/provider-bridge.js list-tasks \
                 --status=ready \
                 --priority=critical \
                 --format=simple | head -1 || true)
    
    if [ -z "$NEXT_ISSUE" ]; then
        # Try high priority tasks
        NEXT_ISSUE=$(node scripts/provider-bridge.js list-tasks \
                     --status=ready \
                     --priority=high \
                     --format=simple | head -1 || true)
    fi
    
    if [ -z "$NEXT_ISSUE" ]; then
        # Fallback to any ready task
        NEXT_ISSUE=$(node scripts/provider-bridge.js list-tasks \
                     --status=ready \
                     --format=simple | head -1 || true)
    fi
    
    if [ -n "$NEXT_ISSUE" ]; then
        NEXT_TASK=$NEXT_ISSUE
        NEXT_CONTEXT="From tasks.json backlog"
        
        # Get issue details from GitHub
        if command -v gh &>/dev/null; then
            NEXT_DESCRIPTION=$(gh issue view "$NEXT_ISSUE" --json title -q '.title' 2>/dev/null || echo "Issue #$NEXT_ISSUE")
            
            # Try to get first microtask from issue body
            BODY=$(gh issue view "$NEXT_ISSUE" --json body -q '.body' 2>/dev/null || echo "")
            if [ -n "$BODY" ]; then
                # Extract first microtask
                FIRST_MT=$(echo "$BODY" | grep -E "^\- \[ \].*\[MT[0-9.]+\]" | head -1 || true)
                if [ -n "$FIRST_MT" ]; then
                    NEXT_MICROTASK=$(echo "$FIRST_MT" | grep -oE "MT[0-9.]+" || echo "MT1.1")
                    MT_DESC=$(echo "$FIRST_MT" | sed 's/.*\] *//' | cut -d'[' -f1)
                    NEXT_DESCRIPTION="$NEXT_DESCRIPTION - $MT_DESC"
                fi
            fi
        fi
    fi
fi

# Display what we found
echo ""
if [ -n "$NEXT_TASK" ]; then
    echo "✅ Next task identified!"
    echo ""
    echo "📋 NEXT WORK ITEM"
    echo "════════════════════════════════════════"
    echo "📌 Task: Issue #$NEXT_TASK"
    if [ -n "$NEXT_MICROTASK" ]; then
        echo "📍 Microtask: $NEXT_MICROTASK"
    fi
    echo "📝 Description: $NEXT_DESCRIPTION"
    echo "⏱️  Estimate: $(format_time $NEXT_ESTIMATE)"
    echo "🔍 Source: $NEXT_CONTEXT"
    echo "════════════════════════════════════════"
else
    echo "❌ No next task found!"
    echo ""
    echo "💡 Options:"
    echo "1. Run /plan to create new tasks"
    echo "2. Check GitHub: gh issue list --state open"
    echo "3. Review .flowforge/tasks.json for upcoming work"
    exit 0
fi
```

## 🔄 Step 3: Confirm Transition
```bash
# Skip confirmation in preview mode
if [ "$PREVIEW_MODE" = true ]; then
    echo ""
    echo "ℹ️  Preview mode - no changes made"
    echo "💡 Run without --preview to transition"
    exit 0
fi

# Get confirmation unless auto mode
if [ "$AUTO_MODE" = false ]; then
    echo ""
    echo -n "🤔 Ready to transition? [Y/n] "
    read -r REPLY
    if [[ ! $REPLY =~ ^[Yy]$ ]] && [[ -n $REPLY ]]; then
        echo "❌ Transition cancelled"
        exit 0
    fi
fi

echo ""
echo "🔄 Transitioning to next task..."
```

## ✅ Step 4: Close Current Work
```bash
# Close current microtask or task
if [ -n "$CURRENT_MICROTASK" ]; then
    echo "✅ Completing $CURRENT_MICROTASK..."
    
    # Update microtask status
    if [ -f ".flowforge/microtask-times.json" ]; then
        # Mark as completed and log time
        jq --arg task "$CURRENT_TASK" \
           --arg mt "$CURRENT_MICROTASK" \
           --arg time "$CURRENT_TIME" \
           '
           .[$task].microtasks[$mt].status = "completed" |
           .[$task].microtasks[$mt].actual_hours = ($time | tonumber) |
           .[$task].microtasks[$mt].completed_at = now | strftime("%Y-%m-%dT%H:%M:%SZ")
           ' .flowforge/microtask-times.json > .flowforge/microtask-times.tmp.json
        mv .flowforge/microtask-times.tmp.json .flowforge/microtask-times.json
    fi
    
    echo "   Actual: $(format_time $CURRENT_TIME)"
    echo "   Estimate: $(format_time $CURRENT_ESTIMATE)"
    VARIANCE=$(awk "BEGIN {printf \"%.0f%%\", (($CURRENT_TIME - $CURRENT_ESTIMATE) / $CURRENT_ESTIMATE) * 100}")
    echo "   Variance: $VARIANCE"
    
elif [ -n "$CURRENT_TASK" ]; then
    echo "⏸️  Pausing Issue #$CURRENT_TASK..."
    .flowforge/scripts/task-time.sh pause "$CURRENT_TASK" "Transitioning to next task" 2>/dev/null || true
fi
```

## 🚀 Step 5: Start Next Task
```bash
echo ""
echo "🚀 Starting $NEXT_TASK${NEXT_MICROTASK:+ - $NEXT_MICROTASK}..."

# Start issue-level tracking if different task
if [ "$NEXT_TASK" != "$CURRENT_TASK" ]; then
    # Switch branches if needed
    EXPECTED_BRANCH="feature/${NEXT_TASK}-work"
    CURRENT_BRANCH=$(git branch --show-current)
    
    if [ "$CURRENT_BRANCH" != "$EXPECTED_BRANCH" ]; then
        if git show-ref --verify --quiet "refs/heads/$EXPECTED_BRANCH"; then
            echo "🔀 Switching to branch: $EXPECTED_BRANCH"
            git checkout "$EXPECTED_BRANCH"
        else
            echo "🌱 Creating branch: $EXPECTED_BRANCH"
            git checkout -b "$EXPECTED_BRANCH"
        fi
    fi
    
    # Start time tracking for new issue
    .flowforge/scripts/task-time.sh start "$NEXT_TASK" 2>/dev/null || true
fi

# Start microtask tracking (FlowForge 2.0)
if [ -n "$NEXT_MICROTASK" ]; then
    # Initialize microtask tracking if needed
    if [ ! -f ".flowforge/microtask-times.json" ]; then
        echo '{}' > .flowforge/microtask-times.json
    fi
    
    # Add/update microtask entry
    jq --arg task "$NEXT_TASK" \
       --arg mt "$NEXT_MICROTASK" \
       --arg desc "$NEXT_DESCRIPTION" \
       --arg est "$NEXT_ESTIMATE" \
       '
       if .[$task] == null then .[$task] = {"microtasks": {}} else . end |
       .[$task].microtasks[$mt] = {
           "description": $desc,
           "estimate_hours": ($est | tonumber),
           "status": "in_progress",
           "started_at": now | strftime("%Y-%m-%dT%H:%M:%SZ"),
           "current_session": {
               "start": now | strftime("%Y-%m-%dT%H:%M:%SZ"),
               "instance_id": env.INSTANCE_ID
           }
       }
       ' .flowforge/microtask-times.json > .flowforge/microtask-times.tmp.json
    mv .flowforge/microtask-times.tmp.json .flowforge/microtask-times.json
    
    echo "✅ Microtask timer started"
fi
```

## 📋 Step 6: Update Documentation
```bash
# Update next.json with new focus
echo ""
echo "📄 Updating session tracking..."

mkdir -p .flowforge/sessions
cat > .flowforge/sessions/next.json << EOF
{
  "session": {
    "timestamp": "$(date +"%Y-%m-%dT%H:%M:%SZ")",
    "activeWork": {
      "issue": "$NEXT_TASK",
      ${NEXT_MICROTASK:+"microtask": "$NEXT_MICROTASK",}
      "description": "$NEXT_DESCRIPTION",
      "estimate": $NEXT_ESTIMATE,
      "started": "$(date +"%H:%M")"
    },
    "implementationPlan": [

# Add implementation hints based on task type
if [[ "$NEXT_DESCRIPTION" == *"test"* ]]; then
    cat >> .flowforge/sessions/next.json << 'EOF'
      "Write failing tests (TDD)",
      "Implement minimal solution",
      "Refactor for quality",
      "Verify all tests pass"
    ],
EOF
elif [[ "$NEXT_DESCRIPTION" == *"document"* ]]; then
    cat >> .flowforge/sessions/next.json << 'EOF'
      "Review existing documentation",
      "Identify gaps",
      "Write clear explanations",
      "Add examples"
    ],
EOF
else
    cat >> .flowforge/sessions/next.json << 'EOF'
      "Understand requirements",
      "Design solution",
      "Implement with tests",
      "Verify and document"
    ],
EOF
fi

# Add context from issue
if command -v gh &>/dev/null && [ -n "$NEXT_TASK" ]; then
    ISSUE_BODY=$(gh issue view "$NEXT_TASK" --json body -q '.body' 2>/dev/null | head -50 | jq -Rs . || echo '""')
    cat >> .flowforge/sessions/next.json << EOF
    "issueContext": $ISSUE_BODY
  }
}
EOF
else
    cat >> .flowforge/sessions/next.json << 'EOF'
    "issueContext": null
  }
}
EOF
fi

echo "✅ Session tracking updated"
```

## 🎯 Step 7: Show Implementation Guidance
```bash
echo ""
echo "════════════════════════════════════════"
echo "✨ READY TO CODE!"
echo "════════════════════════════════════════"
echo ""

# Provide specific guidance based on task
if [ -n "$NEXT_MICROTASK" ]; then
    echo "📍 Microtask: $NEXT_MICROTASK"
    echo "📝 Focus: $NEXT_DESCRIPTION"
    echo "⏱️  Budget: $(format_time $NEXT_ESTIMATE)"
else
    echo "📍 Issue: #$NEXT_TASK"
    echo "📝 Task: $NEXT_DESCRIPTION"
fi

echo ""
echo "💡 Quick Actions:"
echo "   /ff:mt:status     - Check microtask progress"
echo "   /ff:mt:pause      - Take a break"
echo "   /ff:nextTask      - When ready for next"
echo "   /tdd              - Start with tests"
echo ""

# Show files to likely edit
if command -v gh &>/dev/null && [ -n "$NEXT_TASK" ]; then
    echo "📁 Likely files to edit:"
    # Intelligent file suggestions based on task description
    if [[ "$NEXT_DESCRIPTION" == *"test"* ]]; then
        find tests -name "*.sh" 2>/dev/null | head -3 | sed 's/^/   /'
    elif [[ "$NEXT_DESCRIPTION" == *"command"* ]]; then
        find commands -name "*.md" 2>/dev/null | head -3 | sed 's/^/   /'
    else
        echo "   (Run grep/find to locate relevant files)"
    fi
fi

echo ""
echo "🚀 Timer running! Start coding!"
echo "════════════════════════════════════════"
```

## ✅ Success!
Developer can now transition seamlessly between tasks without mental overhead or manual file updates. The flow is continuous and tracked at the microtask level!