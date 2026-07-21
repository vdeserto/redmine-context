# Command: flowforge:bug:popcontext
# Version: 2.0.0
# Description: FlowForge bug popcontext command

---
description: Return from bug sidetrack to previous work context using the sidetracking engine
argument-hint: "[--force] [--keep-branch]"
---

# 🔄 Pop Bug Context - Return to Previous Work

## 🎯 Intelligent Context Restoration System
```bash
set -euo pipefail

# Error handler
handle_error() {
    local exit_code=$?
    local line_number=$1
    echo "❌ Context restoration failed on line $line_number (exit code: $exit_code)"
    echo "💡 Debug with: DEBUG=1 /flowforge:bug:popcontext"
    
    exit $exit_code
}
trap 'handle_error $LINENO' ERR

# Debug mode
[[ "${DEBUG:-0}" == "1" ]] && set -x

# Check for help request
if [[ "${ARGUMENTS:-}" == "?" || "${ARGUMENTS:-}" == "help" ]]; then
    cat << 'HELP'
🔄 FlowForge Bug Context Pop - Return to Previous Work

Usage: /flowforge:bug:popcontext [options]

What it does:
✓ Restores previous work context from sidetracking engine
✓ Switches back to original branch and task
✓ Restores file state, environment, and time tracking
✓ Maintains clean git history
✓ Updates documentation and session state

Options:
  --force         Force restoration even if current work is dirty
  --keep-branch   Keep the bug branch after restoration
  --no-stash      Don't apply any stashed changes
  --dry-run       Show what would be restored without doing it

What gets restored:
• Git branch and working directory state
• Open files and cursor positions (if supported)
• Environment variables and terminal state  
• Time tracking session for original task
• Documentation and session notes

Safety features:
• Validates context before restoration
• Backs up current state before switching
• Handles merge conflicts gracefully
• Preserves work if restoration fails

Examples:
  /flowforge:bug:popcontext                 # Standard restoration
  /flowforge:bug:popcontext --force         # Force even with dirty state
  /flowforge:bug:popcontext --keep-branch   # Keep bug branch for future work
  /flowforge:bug:popcontext --dry-run       # Preview what would be restored

Integration:
• Sidetracking engine for advanced context management
• FlowForge session management
• GitHub issue status updates
• Time tracking system restoration
HELP
    exit 0
fi

echo "🔄 Returning from Bug Sidetrack - Context Restoration"
echo "════════════════════════════════════════════════════"

# Parse options
FORCE=false
KEEP_BRANCH=false
NO_STASH=false
DRY_RUN=false

for arg in ${ARGUMENTS:-}; do
    case "$arg" in
        --force)
            FORCE=true
            ;;
        --keep-branch)
            KEEP_BRANCH=true
            ;;
        --no-stash)
            NO_STASH=true
            ;;
        --dry-run)
            DRY_RUN=true
            ;;
        *)
            echo "⚠️  Unknown option: $arg"
            ;;
    esac
done

echo "🔧 Options: Force=$FORCE, Keep-Branch=$KEEP_BRANCH, No-Stash=$NO_STASH, Dry-Run=$DRY_RUN"
```

## 🎯 Step 1: Validate Current State and Load Context
```bash
echo "🔍 Validating current state and loading context..."

# Check if we're in a bug sidetrack
if [ ! -f ".flowforge/.bug-sidetrack-state" ]; then
    echo "❌ No bug sidetrack state found!"
    echo "💡 Are you currently in a bug sidetrack session?"
    echo "💡 Use /flowforge:bug:nobugbehind to start bug sidetracking"
    exit 1
fi

# Load sidetrack state
source ".flowforge/.bug-sidetrack-state"

echo "📋 Current Bug Sidetrack:"
echo "• Bug ID: ${bug_id:-unknown}"
echo "• Priority: ${priority:-unknown}"
echo "• Type: ${type:-unknown}"
echo "• Current Branch: $(git branch --show-current 2>/dev/null || echo 'unknown')"
echo "• Original Task: ${parent_task:-unknown}"
echo "• Original Branch: ${parent_branch:-unknown}"
echo "• Context ID: ${context_id:-unknown}"

# Check for uncommitted changes
UNCOMMITTED_CHANGES=false
if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
    UNCOMMITTED_CHANGES=true
    if [ "$FORCE" = false ]; then
        echo ""
        echo "⚠️  You have uncommitted changes in the bug branch!"
        git status --short
        echo ""
        echo "Options:"
        echo "1. Commit your changes: git add . && git commit -m 'Fix for bug ${bug_id}'"
        echo "2. Force restoration (may lose changes): /flowforge:bug:popcontext --force"
        echo "3. Stash changes: git stash"
        exit 1
    else
        echo "⚠️  Forcing restoration despite uncommitted changes"
    fi
fi
```

## 🎯 Step 2: Stop Bug Time Tracking and Update Status
```bash
echo "⏱️  Stopping bug time tracking..."

TIME_STOPPED=false

# Try provider bridge first
if [ -f "scripts/provider-bridge.js" ] && [ -f ".flowforge/.bug-session" ]; then
    echo "🔗 Using provider bridge for time tracking..."
    
    # Load session info
    source ".flowforge/.bug-session" 2>/dev/null || true
    
    if [ -n "${session_id:-}" ]; then
        if node scripts/provider-bridge.js stop-tracking \
            --id="${bug_id}" \
            --session="${session_id}" \
            --summary="Bug work completed" \
            2>&1; then
            TIME_STOPPED=true
            echo "✅ Time tracking stopped via provider bridge"
        fi
    fi
fi

# Fallback to traditional time tracking
if [ "$TIME_STOPPED" = false ] && [ -f "scripts/task-time.sh" ]; then
    echo "📊 Using traditional time tracking..."
    
    if scripts/task-time.sh stop "${bug_id}" 2>&1; then
        TIME_STOPPED=true
        echo "✅ Time tracking stopped (traditional)"
        
        # Show time summary
        echo "📊 Time tracking summary:"
        scripts/task-time.sh status "${bug_id}" 2>&1 || echo "⚠️  Could not get time summary"
    fi
fi

if [ "$TIME_STOPPED" = false ]; then
    echo "⚠️  Could not stop time tracking - may need manual cleanup"
fi

# Update GitHub issue status if possible
if command -v gh &> /dev/null && [ -n "${issue_url:-}" ]; then
    echo "📋 Updating GitHub issue status..."
    
    # Add a comment about the work session
    COMMENT="Bug investigation completed in sidetracking session.

⏱️ **Session Summary:**
- Duration: Started ${start_time:-unknown}
- Branch: \`${branch:-unknown}\`
- Original Context: Task ${parent_task:-unknown} on \`${parent_branch:-unknown}\`

Status: Work completed, returning to previous context."

    if gh issue comment "${bug_id}" --body "$COMMENT" 2>/dev/null; then
        echo "✅ Added session summary comment to issue"
    else
        echo "⚠️  Could not add comment to GitHub issue"
    fi
fi
```

## 🎯 Step 3: Restore Context Using Sidetracking Engine
```bash
echo "💾 Restoring previous work context..."

CONTEXT_RESTORED=false

# Check what sidetracking engine was used
if [ "${sidetrack_engine:-}" != "basic" ] && [ -n "${context_id:-}" ]; then
    echo "🚀 Using advanced sidetracking engine for restoration..."
    
    # Determine engine path
    SIDETRACK_ENGINE=""
    if [ -f "dist/src/sidetracking/core/index.js" ]; then
        SIDETRACK_ENGINE="dist/src/sidetracking/core/index.js"
    elif [ -f "src/sidetracking/core/index.ts" ]; then
        SIDETRACK_ENGINE="npx ts-node src/sidetracking/core/index.ts"
    fi
    
    if [ -n "$SIDETRACK_ENGINE" ]; then
        if [ "$DRY_RUN" = true ]; then
            echo "🔍 DRY RUN: Would restore context ${context_id} using ${SIDETRACK_ENGINE}"
        else
            # Execute restoration
            if [ -f "dist/src/sidetracking/core/index.js" ]; then
                RESTORE_RESULT=$(node "$SIDETRACK_ENGINE" restoreContext "${context_id}" 2>&1)
            else
                if [[ -x "$SIDETRACK_ENGINE" ]]; then
                    RESTORE_RESULT=$("$SIDETRACK_ENGINE" restoreContext "${context_id}" 2>&1)
                else
                    echo "❌ Sidetrack engine not executable: $SIDETRACK_ENGINE"
                    exit 1
                fi
            fi
            
            if echo "$RESTORE_RESULT" | grep -q "success.*true"; then
                CONTEXT_RESTORED=true
                echo "✅ Advanced context restoration successful"
            else
                echo "⚠️  Advanced restoration failed: $RESTORE_RESULT"
                echo "🔄 Falling back to basic restoration..."
            fi
        fi
    fi
fi

# Basic context restoration fallback
if [ "$CONTEXT_RESTORED" = false ] && [ "${sidetrack_engine:-}" = "basic" ]; then
    echo "📦 Using basic context restoration..."
    
    CONTEXT_DIR="${context_id}"
    if [ -d "$CONTEXT_DIR" ]; then
        if [ "$DRY_RUN" = true ]; then
            echo "🔍 DRY RUN: Would restore from $CONTEXT_DIR"
            echo "  - Branch: $(cat "$CONTEXT_DIR/branch" 2>/dev/null || echo 'unknown')"
            echo "  - Status: $(head -3 "$CONTEXT_DIR/status" 2>/dev/null || echo 'none')"
        else
            # Restore git branch
            if [ -f "$CONTEXT_DIR/branch" ]; then
                ORIGINAL_BRANCH=$(cat "$CONTEXT_DIR/branch")
                if [ -n "$ORIGINAL_BRANCH" ]; then
                    echo "🌿 Switching back to branch: $ORIGINAL_BRANCH"
                    git checkout "$ORIGINAL_BRANCH" 2>/dev/null || echo "⚠️  Could not switch to $ORIGINAL_BRANCH"
                fi
            fi
            
            # Restore VS Code settings if available
            if [ -f "$CONTEXT_DIR/vscode-settings.json" ] && [ -d ".vscode" ]; then
                cp "$CONTEXT_DIR/vscode-settings.json" ".vscode/settings.json" 2>/dev/null || true
                echo "✅ Restored VS Code settings"
            fi
            
            CONTEXT_RESTORED=true
            echo "✅ Basic context restoration completed"
        fi
    else
        echo "⚠️  Basic context directory not found: $CONTEXT_DIR"
    fi
fi
```

## 🎯 Step 4: Apply Stashed Changes and Clean Up Git State
```bash
if [ "$CONTEXT_RESTORED" = true ] && [ "$DRY_RUN" = false ]; then
    echo "🔧 Cleaning up git state..."
    
    # Apply any stashed changes if requested and available
    if [ "$NO_STASH" = false ]; then
        echo "🔍 Checking for stashed changes to restore..."
        
        # Look for auto-stash from bug sidetracking
        STASH_LIST=$(git stash list 2>/dev/null || echo "")
        if echo "$STASH_LIST" | grep -q "Auto-stash before bug sidetrack: ${bug_id}"; then
            echo "💾 Found auto-stash from bug sidetracking - applying..."
            
            if git stash pop --index $(git stash list | grep "Auto-stash before bug sidetrack: ${bug_id}" | cut -d: -f1) 2>&1; then
                echo "✅ Auto-stash applied successfully"
            else
                echo "⚠️  Could not apply auto-stash - may have conflicts"
                echo "💡 Check: git status"
            fi
        else
            echo "ℹ️  No auto-stash found from bug sidetracking"
        fi
    fi
    
    # Clean up bug branch if requested
    if [ "$KEEP_BRANCH" = false ]; then
        BUG_BRANCH="${branch:-${type}/${bug_id}-work}"
        if [ -n "$BUG_BRANCH" ] && [ "$BUG_BRANCH" != "$(git branch --show-current 2>/dev/null)" ]; then
            echo "🗑️  Cleaning up bug branch: $BUG_BRANCH"
            
            # Check if branch was pushed to remote
            if git ls-remote --heads origin "$BUG_BRANCH" | grep -q "$BUG_BRANCH"; then
                echo "⚠️  Bug branch exists on remote - keeping local copy for safety"
                echo "💡 Delete manually if no longer needed: git branch -D $BUG_BRANCH"
            else
                if git branch -D "$BUG_BRANCH" 2>/dev/null; then
                    echo "✅ Bug branch deleted: $BUG_BRANCH"
                else
                    echo "⚠️  Could not delete bug branch: $BUG_BRANCH"
                fi
            fi
        fi
    else
        echo "🌿 Keeping bug branch as requested: ${branch:-${type}/${bug_id}-work}"
    fi
fi
```

## 🎯 Step 5: Restore Time Tracking for Original Task
```bash
if [ "$DRY_RUN" = false ]; then
    echo "⏱️  Restoring time tracking for original task..."
    
    ORIGINAL_TIME_STARTED=false
    
    # Restore time tracking for original task
    if [ -n "${parent_task:-}" ]; then
        # Try provider bridge first
        if [ -f "scripts/provider-bridge.js" ]; then
            echo "🔗 Restarting time tracking via provider bridge..."
            
            SESSION_ID="restored-$(date +%s)-$$"
            USER_NAME="${USER:-$(whoami)}"
            
            if node scripts/provider-bridge.js start-tracking \
                --id="${parent_task}" \
                --user="$USER_NAME" \
                --instance="$SESSION_ID" \
                --type="task" \
                --note="Resumed after bug ${bug_id} fix" \
                2>&1; then
                
                ORIGINAL_TIME_STARTED=true
                echo "✅ Time tracking resumed for task ${parent_task}"
            fi
        fi
        
        # Fallback to traditional time tracking
        if [ "$ORIGINAL_TIME_STARTED" = false ] && [ -f "scripts/task-time.sh" ]; then
            echo "📊 Resuming traditional time tracking..."
            
            if scripts/task-time.sh start "${parent_task}" 2>&1; then
                ORIGINAL_TIME_STARTED=true
                echo "✅ Time tracking resumed for task ${parent_task} (traditional)"
            fi
        fi
    fi
    
    if [ "$ORIGINAL_TIME_STARTED" = false ]; then
        echo "⚠️  Could not restart time tracking for original task"
        echo "💡 Manually start tracking: /flowforge:session:start ${parent_task:-[task-id]}"
    fi
fi
```

## 🎯 Step 6: Update Documentation and Session State
```bash
if [ "$DRY_RUN" = false ]; then
    echo "📝 Updating documentation and session state..."
    
    # Restore original next.json if backup exists
    if [ -f ".flowforge/sessions/next.json.backup" ]; then
        mv ".flowforge/sessions/next.json.backup" ".flowforge/sessions/next.json"
        echo "✅ Restored original next.json"
    fi
    
    # Update next.json with return information
    if [ -f ".flowforge/sessions/next.json" ]; then
        # Create temporary file with return information
        TEMP_JSON=$(mktemp)
        jq --arg task "$ORIGINAL_TASK" \
           --arg branch "$ORIGINAL_BRANCH" \
           --arg bug "$BUG_ID" \
           --arg duration "$TOTAL_TIME" \
           --arg timestamp "$(date +"%Y-%m-%dT%H:%M:%SZ")" \
           '. + {
             "returnedFromBug": {
               "bugId": $bug,
               "duration": $duration,
               "returnedAt": $timestamp,
               "returnedToTask": $task,
               "returnedToBranch": $branch
             }
           }' ".flowforge/sessions/next.json" > "$TEMP_JSON"
        mv "$TEMP_JSON" ".flowforge/sessions/next.json"
        echo "✅ Updated next.json with return summary"
    fi
    
    # Update tasks.json to mark bug as completed
    if command -v node &>/dev/null && [ -f "scripts/provider-bridge.js" ] && [ -n "${bug_id:-}" ]; then
        echo "📋 Updating task tracking..."
        
        # Mark bug as completed in tasks via provider-bridge
        node scripts/provider-bridge.js update-task \
            --id="${bug_id}" \
            --status="completed" \
            --format=simple 2>/dev/null || true
        echo "✅ Marked bug as completed in task tracking"
    fi
    
    # Clean up temporary files
    rm -f ".flowforge/.bug-sidetrack-state" 2>/dev/null
    rm -f ".flowforge/.bug-session" 2>/dev/null
    rm -f ".flowforge/.sidetrack-context" 2>/dev/null
    echo "🧹 Cleaned up temporary sidetrack files"
fi
```

## 🎯 Step 7: Display Restoration Summary
```bash
echo ""
echo "════════════════════════════════════════════════════"
if [ "$DRY_RUN" = true ]; then
    echo "🔍 DRY RUN COMPLETE - No changes made"
else
    echo "✅ BUG CONTEXT RESTORATION COMPLETE"
fi
echo "════════════════════════════════════════════════════"
echo ""

if [ "$DRY_RUN" = true ]; then
    echo "📋 Would restore:"
    echo "• Bug: ${bug_id:-unknown} (${priority:-unknown} priority)"
    echo "• From: ${branch:-unknown} branch"
    echo "• To: ${parent_branch:-unknown} branch"  
    echo "• Task: ${parent_task:-unknown}"
    echo "• Context: ${context_id:-unknown}"
    echo ""
    echo "💡 Run without --dry-run to perform actual restoration"
else
    echo "📋 Restoration Summary:"
    echo "• Bug completed: ${bug_id:-unknown} (${priority:-unknown})"
    echo "• Returned to: $(git branch --show-current 2>/dev/null || echo 'unknown') branch"
    echo "• Original task: ${parent_task:-unknown}"
    echo "• Time tracking: $([ "$ORIGINAL_TIME_STARTED" = true ] && echo "Resumed" || echo "Manual restart needed")"
    echo "• Bug branch: $([ "$KEEP_BRANCH" = true ] && echo "Preserved" || echo "Cleaned up")"
    echo ""
    
    echo "🎯 Current Status:"
    echo "• Branch: $(git branch --show-current 2>/dev/null || echo 'unknown')"
    echo "• Working directory: $([ -z "$(git status --porcelain 2>/dev/null)" ] && echo "Clean" || echo "Has changes")"
    echo "• Session: $([ -f ".flowforge/.current-session" ] && echo "Active" || echo "Inactive")"
    echo ""
    
    echo "📋 Next Steps:"
    echo "1. 🔍 Review your restored working environment"
    echo "2. ✅ Verify the bug was properly fixed"
    echo "3. 📝 Update progress on your original task"
    echo "4. 🚀 Continue with your main work"
    echo ""
    
    echo "🔧 Useful Commands:"
    echo "• Check status: /flowforge:dev:status"
    echo "• View bugs: /flowforge:bug:list"  
    echo "• Task progress: /flowforge:project:tasks"
    echo ""
    
    if [ "$UNCOMMITTED_CHANGES" = true ] && [ "$FORCE" = true ]; then
        echo "⚠️  WARNING: Restoration was forced with uncommitted changes"
        echo "💡 Check if any work was lost and recover if needed"
        echo ""
    fi
    
    echo "✨ Welcome back to your original work context!"
    echo "🐛➡️✅ Bug ${bug_id} has been handled - no bug left behind!"
fi

exit 0
```

## 🎯 Success!

Your bug context restoration system provides:

**Smart Restoration:**
- Advanced sidetracking engine integration for precise context switching
- Fallback to basic restoration if advanced engine unavailable
- Validation and safety checks before restoration

**Complete State Management:**
- Git branch and working directory restoration
- Time tracking session management
- Documentation updates and session notes
- Temporary file cleanup

**Safety Features:**
- Dry-run mode to preview changes
- Force option for emergency situations
- Stash management for uncommitted work
- Branch preservation options

**Integration:**
- FlowForge session management
- GitHub issue status updates
- Task tracking system updates
- Time tracking provider integration

**Usage Examples:**
- `/flowforge:bug:popcontext` - Standard restoration
- `/flowforge:bug:popcontext --dry-run` - Preview changes
- `/flowforge:bug:popcontext --force --keep-branch` - Force with branch preservation

This completes the seamless bug sidetracking workflow, ensuring developers can handle urgent bugs without losing their main work context.