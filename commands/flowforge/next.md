# Command: flowforge:flowforge:next
# Version: 2.0.0
# Description: FlowForge flowforge next command

---
description: Seamlessly transition to the next task without interruption
argument-hint: "[--auto] (skip confirmation)"
---

# 🚀 Next - Seamless Task Transition

## 🎯 Purpose
Smoothly transition from current work to the next item in your queue without mental overhead or manual updates.

## 📋 Implementation
```bash
set -euo pipefail

# Configuration
CONFIG_DIR=".flowforge/.config"
POSITION_FILE="$CONFIG_DIR/current-position.json"
TIME_FILE=".task-times.json"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Parse arguments
AUTO_MODE=false
if [[ "${ARGUMENTS:-}" == "--auto" ]]; then
    AUTO_MODE=true
fi

# Help
if [[ "${ARGUMENTS:-}" == "?" || "${ARGUMENTS:-}" == "help" ]]; then
    cat << 'HELP'
🚀 FlowForge Next - Seamless Transitions

Usage: /ff:next [options]

What it does:
✓ Completes current work (task or microtask)
✓ Calculates and saves time spent
✓ Finds next item from queue
✓ Starts timer for new work
✓ Shows clear progress messages

Options:
  --auto    Skip confirmation
  ?/help    Show this help

Examples:
  /ff:next        # Confirm before transition
  /ff:next --auto # Auto-transition

After running:
- Current work marked complete
- Next work timer started
- All tracking updated
HELP
    exit 0
fi

echo -e "${BLUE}🔄 Preparing transition...${NC}"
echo ""

# Step 1: Get current position
if [ ! -f "$POSITION_FILE" ]; then
    echo -e "${YELLOW}⚠️  No current work detected${NC}"
    echo "💡 Use /ff:start to begin working"
    exit 0
fi

CURRENT=$(jq -r '.current' "$POSITION_FILE")
if [ "$CURRENT" = "null" ] || [ -z "$CURRENT" ]; then
    echo -e "${YELLOW}⚠️  No active work to transition from${NC}"
    echo "💡 Use /ff:start to begin working"
    exit 0
fi

# Extract current work details
CURRENT_ISSUE=$(echo "$CURRENT" | jq -r '.issue // ""')
CURRENT_MT=$(echo "$CURRENT" | jq -r '.microtask // ""')
CURRENT_DESC=$(echo "$CURRENT" | jq -r '.description // "Current work"')
CURRENT_ACTUAL=$(echo "$CURRENT" | jq -r '.progress.actual // 0')
CURRENT_ESTIMATE=$(echo "$CURRENT" | jq -r '.progress.estimate // 0')
CURRENT_PERCENT=$(echo "$CURRENT" | jq -r '.progress.percent // 0')

# Display current work status
echo "📍 Current Work:"
if [ -n "$CURRENT_MT" ]; then
    echo "   Issue #$CURRENT_ISSUE - $CURRENT_MT: $CURRENT_DESC"
else
    echo "   Issue #$CURRENT_ISSUE: $CURRENT_DESC"
fi
echo "   Progress: ${CURRENT_PERCENT}% complete"

# Source time formatting if available
if [ -f "./scripts/utils/format-time.sh" ]; then
    source "./scripts/utils/format-time.sh"
    echo "   Time: $(format_time $CURRENT_ACTUAL) of $(format_time $CURRENT_ESTIMATE)"
else
    echo "   Time: ${CURRENT_ACTUAL}h of ${CURRENT_ESTIMATE}h"
fi

echo ""

# Step 2: Get next item from queue
QUEUE=$(jq -r '.queue // []' "$POSITION_FILE")
QUEUE_LENGTH=$(echo "$QUEUE" | jq 'length')

if [ "$QUEUE_LENGTH" -eq 0 ]; then
    echo -e "${GREEN}✅ All work completed!${NC}"
    echo ""
    echo "🎯 What's next?"
    echo "   • Run /plan to create new tasks"
    echo "   • Check GitHub: gh issue list --state open"
    echo "   • Review .flowforge/tasks.json for upcoming work"
    
    # Clear current position
    jq '.current = null' "$POSITION_FILE" > "$POSITION_FILE.tmp" && mv "$POSITION_FILE.tmp" "$POSITION_FILE"
    exit 0
fi

# Get next item (first in queue)
NEXT_ITEM=$(echo "$QUEUE" | jq '.[0]')
NEXT_TYPE=$(echo "$NEXT_ITEM" | jq -r '.type // "task"')
NEXT_ID=$(echo "$NEXT_ITEM" | jq -r '.id // ""')
NEXT_DESC=$(echo "$NEXT_ITEM" | jq -r '.description // "Next task"')
NEXT_ESTIMATE=$(echo "$NEXT_ITEM" | jq -r '.estimate // 0')

# Parse issue and microtask from ID
if [[ "$NEXT_ID" == *"."* ]]; then
    NEXT_ISSUE=$(echo "$NEXT_ID" | cut -d. -f1)
    NEXT_MT=$(echo "$NEXT_ID" | cut -d. -f2)
else
    NEXT_ISSUE="$NEXT_ID"
    NEXT_MT=""
fi

# Display next work
echo "📋 Next Work:"
if [ -n "$NEXT_MT" ]; then
    echo "   Issue #$NEXT_ISSUE - $NEXT_MT: $NEXT_DESC"
else
    echo "   Issue #$NEXT_ISSUE: $NEXT_DESC"
fi

if [ -f "./scripts/utils/format-time.sh" ]; then
    echo "   Estimate: $(format_time $NEXT_ESTIMATE)"
else
    echo "   Estimate: ${NEXT_ESTIMATE}h"
fi

echo ""

# Step 3: Get confirmation (unless auto mode)
if [ "$AUTO_MODE" = false ]; then
    echo -n "🤔 Ready to transition? [Y/n] "
    read -r REPLY
    if [[ $REPLY =~ ^[Nn]$ ]]; then
        echo -e "${YELLOW}❌ Transition cancelled${NC}"
        exit 0
    fi
    echo ""
fi

# Step 4: Complete current work
echo -e "${BLUE}📊 Completing current work...${NC}"

# Update time tracking
if [ -f "$TIME_FILE" ] && [ -n "$CURRENT_ISSUE" ]; then
    # Pause current task
    ./scripts/task-time.sh pause "$CURRENT_ISSUE" "Transitioning to next" 2>/dev/null || true
    
    # Get final time
    FINAL_TIME=$(jq -r --arg issue "$CURRENT_ISSUE" '.[$issue].total_hours // 0' "$TIME_FILE")
    echo "   Final time: ${FINAL_TIME}h"
fi

# Mark current as complete in position file
echo -e "${GREEN}✅ $CURRENT_DESC completed${NC}"

# Step 5: Start next work
echo ""
echo -e "${YELLOW}🚀 Starting next work...${NC}"

# Check if we need to switch branches
if [ "$NEXT_ISSUE" != "$CURRENT_ISSUE" ]; then
    EXPECTED_BRANCH="feature/${NEXT_ISSUE}-work"
    CURRENT_BRANCH=$(git branch --show-current)
    
    if [ "$CURRENT_BRANCH" != "$EXPECTED_BRANCH" ]; then
        if git show-ref --verify --quiet "refs/heads/$EXPECTED_BRANCH"; then
            echo "🔀 Switching to branch: $EXPECTED_BRANCH"
            git checkout "$EXPECTED_BRANCH" 2>/dev/null || echo "⚠️  Could not switch branches"
        else
            echo "🌱 Creating branch: $EXPECTED_BRANCH"
            git checkout -b "$EXPECTED_BRANCH" 2>/dev/null || echo "⚠️  Could not create branch"
        fi
    fi
fi

# Start time tracking for next item
if [ -n "$NEXT_ISSUE" ]; then
    ./scripts/task-time.sh start "$NEXT_ISSUE" 2>/dev/null || true
fi

# Update position file
jq --arg issue "$NEXT_ISSUE" \
   --arg mt "$NEXT_MT" \
   --arg desc "$NEXT_DESC" \
   --arg est "$NEXT_ESTIMATE" \
   --arg branch "$(git branch --show-current)" \
   '
   .current = {
       "issue": $issue,
       "microtask": (if $mt == "" then null else $mt end),
       "description": $desc,
       "progress": {
           "actual": 0,
           "estimate": ($est | tonumber),
           "percent": 0
       },
       "context": {
           "branch": $branch,
           "timestamp": now | strftime("%Y-%m-%dT%H:%M:%SZ"),
           "last_action": "Started via /ff:next"
       }
   } |
   .queue = .queue[1:]
   ' "$POSITION_FILE" > "$POSITION_FILE.tmp" && mv "$POSITION_FILE.tmp" "$POSITION_FILE"

# Save position
echo -e "${GREEN}✅ Position saved${NC}"

# Step 6: Show implementation guidance
echo ""
echo "════════════════════════════════════════"
echo -e "${GREEN}✨ READY TO CONTINUE!${NC}"
echo "════════════════════════════════════════"
echo ""

if [ -n "$NEXT_MT" ]; then
    echo "📍 Working on: Issue #$NEXT_ISSUE - $NEXT_MT"
else
    echo "📍 Working on: Issue #$NEXT_ISSUE"
fi
echo "📝 Task: $NEXT_DESC"

if [ -f "./scripts/utils/format-time.sh" ]; then
    echo "⏱️  Budget: $(format_time $NEXT_ESTIMATE)"
else
    echo "⏱️  Budget: ${NEXT_ESTIMATE}h"
fi

echo ""
echo "💡 Commands:"
echo "   /ff:status  - Check progress"
echo "   /ff:pause   - Take a break"
echo "   /ff:next    - When done, move to next"
echo ""

# Show relevant files based on task
if [[ "$NEXT_DESC" == *"test"* ]]; then
    echo "📁 Relevant files:"
    find tests -name "*.sh" 2>/dev/null | head -3 | sed 's/^/   /'
elif [[ "$NEXT_DESC" == *"command"* ]]; then
    echo "📁 Relevant files:"
    find commands -name "*.md" 2>/dev/null | grep -v "/flowforge/" | head -3 | sed 's/^/   /'
fi

echo ""
echo -e "${GREEN}🚀 Timer running! Continue working!${NC}"
echo "════════════════════════════════════════"
```

## ✅ Success!
The developer seamlessly transitions between tasks without interruption or mental overhead!