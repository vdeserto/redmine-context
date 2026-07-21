# Command: flowforge:bug:nobugbehind
# Version: 2.0.0
# Description: FlowForge bug nobugbehind command

---
description: Smart bug sidetracking command that preserves work context and creates appropriate branches with GitHub integration
argument-hint: "[bug-id] [priority:critical|high|medium|low] [type:hotfix|bugfix]"
---

# 🐛 No Bug Left Behind - Smart Sidetracking

## 🚨 Critical Bug Sidetracking System
```bash
set -euo pipefail

# Error handler
handle_error() {
    local exit_code=$?
    local line_number=$1
    echo "❌ Bug sidetracking failed on line $line_number (exit code: $exit_code)"
    echo "💡 Debug with: DEBUG=1 /flowforge:bug:nobugbehind [bug-id]"
    
    # Clean up any partial work
    if [ -n "${TEMP_FILES:-}" ]; then
        for temp_file in $TEMP_FILES; do
            [ -f "$temp_file" ] && rm -f "$temp_file"
        done
    fi
    
    # If we started a sidetrack session, try to restore
    if [ "${SIDETRACK_STARTED:-false}" = "true" ] && [ -n "${SIDETRACK_ENGINE:-}" ]; then
        echo "🔄 Attempting to restore previous context..."
        node "$SIDETRACK_ENGINE" restore 2>/dev/null || echo "⚠️  Manual restore may be required"
    fi
    
    exit $exit_code
}
trap 'handle_error $LINENO' ERR

# Debug mode
[[ "${DEBUG:-0}" == "1" ]] && set -x

# Check for help request
if [[ "${ARGUMENTS:-}" == "?" || "${ARGUMENTS:-}" == "help" ]]; then
    cat << 'HELP'
🐛 FlowForge Bug Sidetracking - No Bug Left Behind

Usage: /flowforge:bug:nobugbehind [bug-id] [priority] [type]

What it does:
✓ Preserves current work context using sidetracking engine
✓ Creates appropriate branch (hotfix/ for critical, bugfix/ for others)
✓ Starts separate time tracking for the bug
✓ Creates GitHub issue if bug-id doesn't exist
✓ Allows seamless return to previous work
✓ Integrates with FlowForge Rules #37 (No Bug Left Behind)

Arguments:
  [bug-id]    Bug identifier (auto-generated if not provided)
  [priority]  critical|high|medium|low (default: medium)
  [type]      hotfix|bugfix (auto-detected based on priority)

Auto-detection features:
• Context-aware bug ID generation based on current task
• Smart priority assignment from keywords in description
• Branch type selection (hotfix for critical/high, bugfix for others)
• Integration with existing sidetracking sessions

Examples:
  /flowforge:bug:nobugbehind                    # Auto-detect everything
  /flowforge:bug:nobugbehind 456                # Work on bug #456
  /flowforge:bug:nobugbehind 456 critical      # Critical bug #456
  /flowforge:bug:nobugbehind 456 high hotfix   # High priority hotfix

Performance: Target <370ms for context switch (Rule #37)
Integrates with: Sidetracking engine, GitHub, time tracking
HELP
    exit 0
fi

echo "🐛 Starting Bug Sidetracking - No Bug Left Behind"
echo "════════════════════════════════════════════════════"
```

## 🎯 Step 1: Parse Arguments and Auto-Detection
```bash
# Parse arguments
ARGS=(${ARGUMENTS:-})
BUG_ID="${ARGS[0]:-}"
PRIORITY="${ARGS[1]:-}"
BUG_TYPE="${ARGS[2]:-}"

# Auto-detection variables
DETECTED_BUG_ID=""
DETECTED_PRIORITY=""
DETECTED_TYPE=""
CURRENT_TASK=""
CURRENT_BRANCH=""

# Get current context for auto-detection
if git rev-parse --git-dir > /dev/null 2>&1; then
    CURRENT_BRANCH=$(git branch --show-current 2>/dev/null || echo "unknown")
    
    # Extract current task from branch name
    if [[ "$CURRENT_BRANCH" =~ feature/([0-9]+)- ]]; then
        CURRENT_TASK="${BASH_REMATCH[1]}"
    elif [[ "$CURRENT_BRANCH" =~ (bugfix|hotfix)/([^-]+)- ]]; then
        CURRENT_TASK="${BASH_REMATCH[2]}"
    fi
else
    echo "❌ Not in a git repository!"
    exit 1
fi

# Check if sidetracking engine is available
SIDETRACK_ENGINE=""
if [ -f "dist/src/sidetracking/core/index.js" ]; then
    SIDETRACK_ENGINE="dist/src/sidetracking/core/index.js"
elif [ -f "src/sidetracking/core/index.ts" ]; then
    SIDETRACK_ENGINE="npx ts-node src/sidetracking/core/index.ts"
else
    echo "⚠️  Sidetracking engine not found - using basic context preservation"
    SIDETRACK_ENGINE="basic"
fi

echo "🔍 Context Detection:"
echo "• Current branch: $CURRENT_BRANCH"
echo "• Current task: ${CURRENT_TASK:-'none detected'}"
echo "• Sidetracking engine: ${SIDETRACK_ENGINE:-'basic mode'}"
```

## 🎯 Step 2: Bug ID Generation and Validation
```bash
# Auto-generate bug ID if not provided
if [ -z "$BUG_ID" ]; then
    echo "🎲 Auto-generating bug ID..."
    
    # Try to get next bug number from various sources
    NEXT_BUG_ID=""
    
    # Check GitHub for next issue number
    if command -v gh &> /dev/null; then
        if LATEST_ISSUE=$(gh issue list --limit 1 --state all --json number -q '.[0].number' 2>/dev/null); then
            if [ -n "$LATEST_ISSUE" ] && [[ "$LATEST_ISSUE" =~ ^[0-9]+$ ]]; then
                NEXT_BUG_ID=$((LATEST_ISSUE + 1))
                echo "✅ Next GitHub issue: #$NEXT_BUG_ID"
            fi
        fi
    fi
    
    # Fallback to timestamp-based ID
    if [ -z "$NEXT_BUG_ID" ]; then
        NEXT_BUG_ID="BUG-$(date +%Y%m%d%H%M)"
        echo "✅ Generated timestamp-based ID: $NEXT_BUG_ID"
    fi
    
    BUG_ID="$NEXT_BUG_ID"
else
    echo "🎯 Using provided bug ID: $BUG_ID"
fi

# Validate/format bug ID
if [[ "$BUG_ID" =~ ^[0-9]+$ ]]; then
    # Numeric ID - keep as is for GitHub
    FORMATTED_BUG_ID="$BUG_ID"
elif [[ "$BUG_ID" =~ ^BUG- ]]; then
    # Already formatted
    FORMATTED_BUG_ID="$BUG_ID"
else
    # Add BUG- prefix
    FORMATTED_BUG_ID="BUG-$BUG_ID"
fi

echo "🏷️  Bug ID: $FORMATTED_BUG_ID"
```

## 🎯 Step 3: Priority Detection and Branch Type Selection
```bash
# Auto-detect priority if not provided
if [ -z "$PRIORITY" ]; then
    echo "🔍 Auto-detecting priority..."
    
    # Interactive mode - ask user
    if [ -t 0 ]; then
        echo "What's the priority of this bug?"
        echo "1) Critical (production down, security issue)"
        echo "2) High (major feature broken, performance issue)"
        echo "3) Medium (minor feature issue, non-critical bug)"
        echo "4) Low (cosmetic, nice-to-have fix)"
        echo -n "Select [1-4] (default: 3): "
        
        read -r PRIORITY_CHOICE
        case "${PRIORITY_CHOICE:-3}" in
            1) PRIORITY="critical" ;;
            2) PRIORITY="high" ;;
            3) PRIORITY="medium" ;;
            4) PRIORITY="low" ;;
            *) PRIORITY="medium" ;;
        esac
    else
        PRIORITY="medium"
        echo "⚠️  Non-interactive mode - defaulting to medium priority"
    fi
else
    # Validate provided priority
    case "$PRIORITY" in
        critical|high|medium|low)
            echo "✅ Priority validated: $PRIORITY"
            ;;
        *)
            echo "⚠️  Invalid priority '$PRIORITY' - defaulting to medium"
            PRIORITY="medium"
            ;;
    esac
fi

# Auto-detect branch type based on priority
if [ -z "$BUG_TYPE" ]; then
    case "$PRIORITY" in
        critical|high)
            BUG_TYPE="hotfix"
            echo "🚨 High priority bug - using hotfix branch"
            ;;
        medium|low)
            BUG_TYPE="bugfix"
            echo "🐛 Standard bug - using bugfix branch"
            ;;
    esac
else
    # Validate provided type
    case "$BUG_TYPE" in
        hotfix|bugfix)
            echo "✅ Branch type validated: $BUG_TYPE"
            ;;
        *)
            echo "⚠️  Invalid type '$BUG_TYPE' - auto-detecting"
            BUG_TYPE=$( [ "$PRIORITY" = "critical" ] || [ "$PRIORITY" = "high" ] && echo "hotfix" || echo "bugfix" )
            ;;
    esac
fi

# Determine branch name
BRANCH_NAME="$BUG_TYPE/$FORMATTED_BUG_ID-work"
echo "🌿 Target branch: $BRANCH_NAME"

echo ""
echo "📋 Bug Summary:"
echo "• ID: $FORMATTED_BUG_ID"
echo "• Priority: $PRIORITY"
echo "• Type: $BUG_TYPE"
echo "• Branch: $BRANCH_NAME"
echo ""
```

## 🎯 Step 4: Save Current Context Using Sidetracking Engine
```bash
echo "💾 Preserving current work context..."

CONTEXT_ID=""
SIDETRACK_STARTED=false

if [ "$SIDETRACK_ENGINE" != "basic" ]; then
    echo "🚀 Using advanced sidetracking engine..."
    
    # Start sidetracking operation
    if [ -f "$SIDETRACK_ENGINE" ]; then
        # Use compiled engine
        SIDETRACK_RESULT=$(node "$SIDETRACK_ENGINE" saveContext "${CURRENT_TASK:-current}" "$FORMATTED_BUG_ID" 2>&1)
    else
        # Use TypeScript directly
        if [[ -x "$SIDETRACK_ENGINE" ]]; then
            SIDETRACK_RESULT=$("$SIDETRACK_ENGINE" saveContext "${CURRENT_TASK:-current}" "$FORMATTED_BUG_ID" 2>&1)
        else
            echo "❌ Sidetrack engine not executable: $SIDETRACK_ENGINE"
            exit 1
        fi
    fi
    
    if echo "$SIDETRACK_RESULT" | grep -q "success.*true"; then
        CONTEXT_ID=$(echo "$SIDETRACK_RESULT" | grep -o '"id":"[^"]*"' | cut -d'"' -f4)
        SIDETRACK_STARTED=true
        echo "✅ Context saved with ID: $CONTEXT_ID"
        
        # Save context ID for later restoration
        echo "$CONTEXT_ID" > ".flowforge/.sidetrack-context"
        echo "${CURRENT_TASK:-current}" >> ".flowforge/.sidetrack-context"
    else
        echo "⚠️  Advanced sidetracking failed, falling back to basic mode"
        echo "Error: $SIDETRACK_RESULT"
        SIDETRACK_ENGINE="basic"
    fi
fi

# Basic context preservation fallback
if [ "$SIDETRACK_ENGINE" = "basic" ]; then
    echo "📦 Using basic context preservation..."
    
    # Create context preservation directory
    CONTEXT_DIR=".flowforge/context/$(date +%s)"
    mkdir -p "$CONTEXT_DIR"
    
    # Save current git state
    echo "$CURRENT_BRANCH" > "$CONTEXT_DIR/branch"
    git status --porcelain > "$CONTEXT_DIR/status" 2>/dev/null || true
    git log -1 --format="%H %s" > "$CONTEXT_DIR/commit" 2>/dev/null || true
    
    # Save current working files (if in VS Code or similar)
    if [ -f ".vscode/settings.json" ]; then
        cp ".vscode/settings.json" "$CONTEXT_DIR/vscode-settings.json" 2>/dev/null || true
    fi
    
    # Save environment variables related to the project
    env | grep -E "^(NODE_|NPM_|FLOWFORGE_)" > "$CONTEXT_DIR/env" 2>/dev/null || true
    
    CONTEXT_ID="$CONTEXT_DIR"
    echo "✅ Basic context saved to: $CONTEXT_ID"
    
    # Save context info
    echo "$CONTEXT_ID" > ".flowforge/.sidetrack-context"
    echo "${CURRENT_TASK:-current}" >> ".flowforge/.sidetrack-context"
fi
```

## 🎯 Step 5: Create Bug Branch and Switch Context
```bash
echo "🌿 Setting up bug branch..."

# Check if we need to stash changes
STASH_CREATED=false
if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
    echo "💾 Stashing uncommitted changes..."
    if git stash push -m "Auto-stash before bug sidetrack: $FORMATTED_BUG_ID" 2>&1; then
        STASH_CREATED=true
        echo "✅ Changes stashed successfully"
    else
        echo "⚠️  Could not stash changes - continuing anyway"
    fi
fi

# Ensure we're on a clean base branch for hotfixes
if [ "$BUG_TYPE" = "hotfix" ]; then
    echo "🚨 Creating hotfix from main branch..."
    
    # Switch to main and pull latest
    git checkout main 2>/dev/null || git checkout master 2>/dev/null || echo "⚠️  Could not switch to main branch"
    git pull origin main 2>/dev/null || git pull origin master 2>/dev/null || echo "⚠️  Could not pull latest changes"
    
    BASE_BRANCH=$(git branch --show-current)
    echo "✅ Using base branch: $BASE_BRANCH"
else
    BASE_BRANCH="$CURRENT_BRANCH"
    echo "🐛 Creating bugfix from current branch: $BASE_BRANCH"
fi

# Create and switch to bug branch
if git show-ref --verify --quiet "refs/heads/$BRANCH_NAME"; then
    echo "🔀 Switching to existing branch: $BRANCH_NAME"
    git checkout "$BRANCH_NAME"
else
    echo "🌱 Creating new branch: $BRANCH_NAME"
    if git checkout -b "$BRANCH_NAME"; then
        echo "✅ Branch created and checked out"
        
        # Push to remote to establish tracking
        if git push -u origin "$BRANCH_NAME" 2>/dev/null; then
            echo "✅ Branch pushed to remote"
        else
            echo "⚠️  Could not push to remote (will push later)"
        fi
    else
        echo "❌ Failed to create branch!"
        exit 1
    fi
fi
```

## 🎯 Step 6: Create or Verify GitHub Issue
```bash
echo "📋 Setting up GitHub issue..."

ISSUE_EXISTS=false
ISSUE_URL=""

if command -v gh &> /dev/null; then
    # Check if issue already exists (for numeric IDs)
    if [[ "$FORMATTED_BUG_ID" =~ ^[0-9]+$ ]]; then
        if gh issue view "$FORMATTED_BUG_ID" --json url -q .url >/dev/null 2>&1; then
            ISSUE_EXISTS=true
            ISSUE_URL=$(gh issue view "$FORMATTED_BUG_ID" --json url -q .url)
            echo "✅ Found existing issue: $ISSUE_URL"
        fi
    fi
    
    # Create issue if it doesn't exist
    if [ "$ISSUE_EXISTS" = false ]; then
        echo "🆕 Creating new GitHub issue..."
        
        # Interactive issue creation if in terminal
        if [ -t 0 ]; then
            echo -n "Enter bug title: "
            read -r BUG_TITLE
            echo -n "Enter bug description (optional): "
            read -r BUG_DESCRIPTION
        else
            BUG_TITLE="Bug: $FORMATTED_BUG_ID - Auto-detected issue"
            BUG_DESCRIPTION="Auto-created bug issue during sidetracking operation.\n\nOriginal context: Task ${CURRENT_TASK:-'unknown'} on branch $CURRENT_BRANCH\nPriority: $PRIORITY\nType: $BUG_TYPE"
        fi
        
        # Create issue with labels
        LABELS="bug,$PRIORITY"
        if [ "$BUG_TYPE" = "hotfix" ]; then
            LABELS="$LABELS,hotfix"
        fi
        
        if ISSUE_URL=$(gh issue create \
            --title "$BUG_TITLE" \
            --body "$BUG_DESCRIPTION" \
            --label "$LABELS" \
            2>/dev/null); then
            
            # Extract issue number from URL
            ISSUE_NUMBER=$(echo "$ISSUE_URL" | grep -o '/[0-9]*$' | cut -d'/' -f2)
            if [ -n "$ISSUE_NUMBER" ]; then
                FORMATTED_BUG_ID="$ISSUE_NUMBER"
                echo "✅ Created issue #$ISSUE_NUMBER: $ISSUE_URL"
                
                # Update branch name if we got a numeric ID
                NEW_BRANCH_NAME="$BUG_TYPE/$ISSUE_NUMBER-work"
                if [ "$NEW_BRANCH_NAME" != "$BRANCH_NAME" ]; then
                    echo "🔄 Updating branch name to match issue number..."
                    git branch -m "$BRANCH_NAME" "$NEW_BRANCH_NAME" 2>/dev/null || true
                    BRANCH_NAME="$NEW_BRANCH_NAME"
                fi
            fi
        else
            echo "⚠️  Could not create GitHub issue - continuing anyway"
        fi
    fi
else
    echo "⚠️  GitHub CLI not available - skipping issue creation"
fi
```

## 🎯 Step 7: Start Time Tracking
```bash
echo "⏱️  Starting time tracking for bug..."

TIME_TRACKING_STARTED=false

# Try provider bridge first
if [ -f "scripts/provider-bridge.js" ]; then
    echo "🔗 Using provider bridge for time tracking..."
    
    SESSION_ID="bug-$FORMATTED_BUG_ID-$(date +%s)"
    USER_NAME="${USER:-$(whoami)}"
    
    if node scripts/provider-bridge.js start-tracking \
        --id="$FORMATTED_BUG_ID" \
        --user="$USER_NAME" \
        --instance="$SESSION_ID" \
        --type="bug" \
        --parent="${CURRENT_TASK:-}" \
        2>&1; then
        
        TIME_TRACKING_STARTED=true
        echo "✅ Time tracking started via provider bridge"
        
        # Save session info
        cat > ".flowforge/.bug-session" << EOF
bug_id=$FORMATTED_BUG_ID
session_id=$SESSION_ID
parent_task=${CURRENT_TASK:-}
start_time=$(date -Iseconds)
branch=$BRANCH_NAME
context_id=${CONTEXT_ID}
EOF
    fi
fi

# Fallback to traditional time tracking
if [ "$TIME_TRACKING_STARTED" = false ] && [ -f "scripts/task-time.sh" ]; then
    echo "📊 Using traditional time tracking..."
    
    if scripts/task-time.sh start "$FORMATTED_BUG_ID" 2>&1; then
        TIME_TRACKING_STARTED=true
        echo "✅ Time tracking started (traditional)"
        
        # Create session file for bug tracking
        cat > ".flowforge/.bug-session" << EOF
bug_id=$FORMATTED_BUG_ID
parent_task=${CURRENT_TASK:-}
start_time=$(date -Iseconds)
branch=$BRANCH_NAME
context_id=${CONTEXT_ID}
tracking_method=traditional
EOF
    fi
fi

if [ "$TIME_TRACKING_STARTED" = false ]; then
    echo "⚠️  Time tracking not available"
    echo "💡 Manual time tracking recommended for billing accuracy"
    
    # Create minimal session file
    cat > ".flowforge/.bug-session" << EOF
bug_id=$FORMATTED_BUG_ID
parent_task=${CURRENT_TASK:-}
start_time=$(date -Iseconds)
branch=$BRANCH_NAME
context_id=${CONTEXT_ID}
tracking_method=manual
EOF
fi
```

## 🎯 Step 8: Update Documentation and Context
```bash
echo "📝 Updating documentation and context..."

# Update next.json for the bug
mkdir -p .flowforge/sessions
if [ -f ".flowforge/sessions/next.json" ]; then
    cp ".flowforge/sessions/next.json" ".flowforge/sessions/next.json.backup" 2>/dev/null || true
fi

cat > ".flowforge/sessions/next.json" << EOF
# 🐛 Bug Sidetrack Session - $FORMATTED_BUG_ID

## Current Work: Bug Fix $FORMATTED_BUG_ID
Priority: $PRIORITY | Type: $BUG_TYPE | Branch: $BRANCH_NAME

### Session Started: $(date +"%Y-%m-%d %H:%M")

### Bug Context:
- Original task: ${CURRENT_TASK:-'Unknown'}
- Original branch: $CURRENT_BRANCH
- Context preserved: ${CONTEXT_ID}
- Issue URL: ${ISSUE_URL:-'Not created'}

### What's Next:
- [ ] Reproduce the bug
- [ ] Identify root cause
- [ ] Write test that fails (TDD - Rule #3)
- [ ] Implement fix
- [ ] Verify fix resolves issue
- [ ] Return to previous work

### Bug Fix Notes:
(Add investigation and fix notes here)

### Return Command:
\`\`\`bash
# When bug is fixed, return to previous work:
/flowforge:bug:popcontext
\`\`\`

---
Generated by FlowForge Bug Sidetracking
Original context: ${CURRENT_TASK:-'Unknown'} on $CURRENT_BRANCH
EOF

# Update tasks tracking
if command -v node &>/dev/null && [ -f "scripts/provider-bridge.js" ]; then
    # Add bug to task tracking via provider-bridge
    echo "📋 Adding bug to task tracking..."
    
    # Create or update task for the bug
    if [ -n "$FORMATTED_BUG_ID" ]; then
        # Create new task for the bug
        BUG_TASK_ID=$(node scripts/provider-bridge.js create-task \
            --title="Bug #$FORMATTED_BUG_ID" \
            --description="Bug fix started $(date +\"%Y-%m-%d\") - Priority: $PRIORITY" \
            --status="in_progress" \
            --priority="$PRIORITY" \
            --labels="type:bug,priority:$PRIORITY" \
            --format=simple 2>/dev/null || echo "")
        
        if [ -n "$BUG_TASK_ID" ]; then
            echo "✅ Added bug to task tracking (ID: $BUG_TASK_ID)"
        else
            echo "⚠️  Could not add bug to task tracking"
        fi
    fi
fi
```

## 🎯 Step 9: Final Setup and Instructions
```bash
echo ""
echo "════════════════════════════════════════════════════"
echo "🐛 BUG SIDETRACK COMPLETE - NO BUG LEFT BEHIND"
echo "════════════════════════════════════════════════════"
echo ""
echo "📋 Bug Information:"
echo "• ID: $FORMATTED_BUG_ID"
echo "• Priority: $PRIORITY ($BUG_TYPE)"
echo "• Branch: $BRANCH_NAME"
if [ -n "$ISSUE_URL" ]; then
    echo "• Issue: $ISSUE_URL"
fi
echo ""

echo "🎯 Current Status:"
echo "• Previous context: Saved (${CONTEXT_ID})"
echo "• Time tracking: $([ "$TIME_TRACKING_STARTED" = true ] && echo "Active" || echo "Manual")"
echo "• Git branch: $(git branch --show-current 2>/dev/null || echo "Unknown")"
echo ""

echo "📋 Next Steps:"
echo "1. 🔍 Investigate and reproduce the bug"
echo "2. 🧪 Write a failing test (Rule #3 - TDD)"  
echo "3. 🔧 Implement the fix"
echo "4. ✅ Verify the fix works"
echo "5. 🔄 Return to previous work"
echo ""

echo "🔧 Useful Commands:"
echo "• /flowforge:bug:list - View all bugs"
echo "• /flowforge:bug:add - Add more bugs to backlog"
echo "• gh issue view $FORMATTED_BUG_ID - View issue details"
echo "• git log --oneline - See commit history"
echo ""

echo "🔄 When Done (IMPORTANT):"
echo "Run this command to return to your previous work:"
echo "• /flowforge:session:end \"Fixed bug $FORMATTED_BUG_ID\" && /flowforge:bug:popcontext"
echo ""

echo "⚠️  FlowForge Rule #37: No Bug Left Behind"
echo "This bug is now tracked and will not be forgotten!"
echo ""

# Save final state
cat > ".flowforge/.bug-sidetrack-state" << EOF
bug_id=$FORMATTED_BUG_ID
priority=$PRIORITY
type=$BUG_TYPE
branch=$BRANCH_NAME
context_id=$CONTEXT_ID
parent_task=${CURRENT_TASK:-}
parent_branch=$CURRENT_BRANCH
start_time=$(date -Iseconds)
issue_url=${ISSUE_URL:-}
time_tracking=$TIME_TRACKING_STARTED
sidetrack_engine=$SIDETRACK_ENGINE
EOF

echo "💾 Bug sidetrack state saved to .flowforge/.bug-sidetrack-state"
echo "🚀 Ready to fix the bug! No bug left behind! 🐛➡️✅"

exit 0
```

## 🎯 Success!

Your bug sidetracking session is now active. The system has:

**Preserved Context:**
- Saved current work state using the sidetracking engine
- Stashed uncommitted changes if needed
- Recorded current branch and task information

**Set Up Bug Environment:**
- Created appropriate branch (hotfix/bugfix based on priority)  
- Started separate time tracking for accurate billing
- Created or linked GitHub issue with proper labels

**Enabled Seamless Return:**
- All context information stored for restoration
- Clear instructions for returning to previous work
- Integration with FlowForge session management

**Next Steps:**
1. Investigate and fix the bug using TDD (Rule #3)
2. Use `/flowforge:session:end "Fixed bug"` when complete
3. Return to previous work seamlessly

This implements FlowForge Rule #37: "No Bug Left Behind" - ensuring every bug is tracked, timed, and resolved without losing productivity context.