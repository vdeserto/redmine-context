# Command: flowforge:namespace:sync
# Version: 2.0.0
# Description: Manually sync namespace data with Git
# Issue: #548 - Git-Integrated Namespace System

---
description: Synchronize namespace data with Git for cross-machine access
---

# 🔄 FlowForge Namespace Sync

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
        echo "💡 Git operation failed - check repository status"
    elif [[ "${BASH_COMMAND:-}" =~ "jq" ]]; then
        echo "💡 JSON processing failed - check data integrity"
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
🔄 FlowForge Namespace Sync

Synchronize namespace data with Git for cross-machine collaboration.

Usage: /flowforge:namespace:sync [action] [options]

Actions:
  (none)/sync    Perform full sync (default)
  pull           Pull latest namespace data from Git
  push           Push local namespace data to Git
  status         Show sync status
  migrate        Migrate to Git-based namespace
  help, ?        Show this help message

Options:
  --force        Force sync even with conflicts
  --dry-run      Show what would be synced
  --developer ID Override developer ID

Features:
  • Automatic conflict resolution
  • Session history preservation
  • Time tracking synchronization
  • Cross-machine collaboration
  • Performance optimized (<2s)

Examples:
  /flowforge:namespace:sync              # Full sync
  /flowforge:namespace:sync pull         # Get latest from Git
  /flowforge:namespace:sync push         # Share your data
  /flowforge:namespace:sync status       # Check sync status
  /flowforge:namespace:sync --dry-run    # Preview changes

Related commands:
  /flowforge:session:restore   Restore session from sync
  /flowforge:team:status       View team sync status

EOF
    exit 0
fi
```

## 🔍 Parse Options
```bash
# Initialize options
SYNC_ACTION="sync"
FORCE_SYNC=false
DRY_RUN=false
DEVELOPER_OVERRIDE=""

# Parse arguments
for arg in ${ARGUMENTS:-}; do
    case "$arg" in
        # Actions
        sync|pull|push|status|migrate)
            SYNC_ACTION="$arg"
            ;;

        # Options
        --force)
            FORCE_SYNC=true
            ;;

        --dry-run)
            DRY_RUN=true
            ;;

        --developer)
            # Next argument should be developer ID
            DEVELOPER_OVERRIDE="${arg#*=}"
            if [[ -z "$DEVELOPER_OVERRIDE" ]]; then
                DEVELOPER_OVERRIDE="${ARGUMENTS##* }"
            fi
            ;;

        --*)
            echo "⚠️  Unknown option: $arg"
            ;;
    esac
done
```

## 🛠️ Setup Paths and Scripts
```bash
# Get project root and paths
PROJECT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
FLOWFORGE_ROOT="${FLOWFORGE_ROOT_OVERRIDE:-$PROJECT_ROOT}/.flowforge"
DEVELOPER_ID="${DEVELOPER_OVERRIDE:-${FLOWFORGE_DEVELOPER_ID:-$(whoami)}}"

# Export for scripts
export FLOWFORGE_ROOT_OVERRIDE="$PROJECT_ROOT"
export FLOWFORGE_DEVELOPER_ID="$DEVELOPER_ID"

# Locate sync scripts
GIT_SYNC_SCRIPT=""
MIGRATE_SCRIPT=""

for location in \
    "$PROJECT_ROOT/scripts/namespace/git-sync.sh" \
    "$(dirname "$0")/../../../scripts/namespace/git-sync.sh"; do
    if [[ -f "$location" ]]; then
        GIT_SYNC_SCRIPT="$location"
        break
    fi
done

for location in \
    "$PROJECT_ROOT/scripts/namespace/migrate-to-git.sh" \
    "$(dirname "$0")/../../../scripts/namespace/migrate-to-git.sh"; do
    if [[ -f "$location" ]]; then
        MIGRATE_SCRIPT="$location"
        break
    fi
done

if [[ -z "$GIT_SYNC_SCRIPT" ]]; then
    echo "❌ Error: git-sync.sh not found"
    exit 1
fi
```

## 📊 Show Sync Status
```bash
show_sync_status() {
    echo "📊 Namespace Sync Status"
    echo "======================="
    echo ""

    # Check if namespace exists
    if [[ ! -d "$FLOWFORGE_ROOT/developers/$DEVELOPER_ID" ]]; then
        echo "⚠️  No namespace found for: $DEVELOPER_ID"
        echo "💡 Run migration first: /flowforge:namespace:sync migrate"
        return 1
    fi

    # Check Git status
    echo "🌿 Git Integration:"

    if [[ -d "$FLOWFORGE_ROOT/.git" ]]; then
        echo "✅ Git tracking enabled"

        cd "$FLOWFORGE_ROOT"

        # Check for uncommitted changes
        if ! git diff --quiet 2>/dev/null; then
            echo "⚠️  Uncommitted changes detected:"

            git diff --stat 2>/dev/null | head -5
            echo ""
        else
            echo "✅ No uncommitted changes"
        fi

        # Check sync status with remote
        if git remote get-url origin >/dev/null 2>&1; then
            # Fetch latest (dry-run)
            git fetch --dry-run 2>&1 | grep -q "up to date" && {
                echo "✅ In sync with remote"
            } || {
                echo "⚠️  Updates available from remote"
            }

            # Check unpushed commits
            local unpushed=$(git log origin/$(git branch --show-current)..HEAD --oneline 2>/dev/null | wc -l)
            if [[ $unpushed -gt 0 ]]; then
                echo "📤 $unpushed unpushed commits"
            fi
        else
            echo "⚠️  No remote configured"
        fi
    else
        echo "❌ Git tracking not initialized"
        echo "💡 Run: /flowforge:namespace:sync migrate"
    fi

    echo ""
    echo "📂 Namespace Data:"

    # Show namespace statistics
    local dev_dir="$FLOWFORGE_ROOT/developers/$DEVELOPER_ID"

    if [[ -f "$dev_dir/profile.json" ]]; then
        local last_synced=$(jq -r '.last_synced // "never"' "$dev_dir/profile.json")
        echo "  • Last synced: $last_synced"
    fi

    if [[ -d "$dev_dir/sessions/history" ]]; then
        local session_count=$(find "$dev_dir/sessions/history" -name "*.json" 2>/dev/null | wc -l)
        echo "  • Session history: $session_count sessions"
    fi

    if [[ -d "$dev_dir/time-tracking" ]]; then
        local time_files=$(find "$dev_dir/time-tracking" -name "*.json" 2>/dev/null | wc -l)
        echo "  • Time tracking: $time_files months tracked"
    fi

    # Check active session
    if [[ -f "$dev_dir/sessions/current/session.json" ]]; then
        local active=$(jq -r '.active // false' "$dev_dir/sessions/current/session.json")
        if [[ "$active" == "true" ]]; then
            local session_id=$(jq -r '.session_id // "unknown"' "$dev_dir/sessions/current/session.json")
            echo "  • Active session: $session_id"
        fi
    fi
}
```

## 🔄 Perform Sync Operations
```bash
perform_sync() {
    echo "🔄 Synchronizing Namespace Data"
    echo "==============================="
    echo "Developer: $DEVELOPER_ID"
    echo ""

    # Check for dry run
    if [[ "$DRY_RUN" == "true" ]]; then
        echo "🔍 DRY RUN MODE - No changes will be made"
        echo ""
    fi

    case "$SYNC_ACTION" in
        sync)
            echo "📥 Pulling latest changes..."

            if [[ "$DRY_RUN" != "true" ]]; then
                # Pull latest from Git
                if [[ -d "$FLOWFORGE_ROOT/.git" ]]; then
                    cd "$FLOWFORGE_ROOT"
                    git pull --rebase 2>/dev/null || {
                        echo "⚠️  Pull failed, attempting merge..."
                        git pull --no-rebase
                    }
                fi
            else
                echo "  Would pull from: $(git remote get-url origin 2>/dev/null || echo 'no remote')"
            fi

            echo ""
            echo "📤 Syncing local changes..."

            if [[ "$DRY_RUN" != "true" ]]; then
                # Run sync script
                bash "$GIT_SYNC_SCRIPT" sync
            else
                echo "  Would sync:"
                echo "    • Developer profile"
                echo "    • Session history"
                echo "    • Time tracking data"
            fi

            echo ""
            echo "📤 Pushing to remote..."

            if [[ "$DRY_RUN" != "true" ]]; then
                # Push to remote if configured
                if [[ -d "$FLOWFORGE_ROOT/.git" ]] && git remote get-url origin >/dev/null 2>&1; then
                    cd "$FLOWFORGE_ROOT"
                    git push
                    echo "✅ Pushed to remote"
                fi
            else
                echo "  Would push to: $(git remote get-url origin 2>/dev/null || echo 'no remote')"
            fi
            ;;

        pull)
            echo "📥 Pulling namespace data from Git..."

            if [[ "$DRY_RUN" != "true" ]]; then
                if [[ -d "$FLOWFORGE_ROOT/.git" ]]; then
                    cd "$FLOWFORGE_ROOT"

                    # Stash local changes if force not set
                    if [[ "$FORCE_SYNC" != "true" ]] && ! git diff --quiet 2>/dev/null; then
                        echo "💾 Stashing local changes..."
                        git stash push -m "namespace-sync-$(date +%s)"
                    fi

                    # Pull latest
                    git pull --rebase || {
                        echo "⚠️  Rebase failed, attempting merge..."
                        git pull --no-rebase
                    }

                    # Resolve conflicts if needed
                    bash "$GIT_SYNC_SCRIPT" resolve-conflicts

                    echo "✅ Pull complete"
                else
                    echo "❌ Git not initialized"
                    exit 1
                fi
            else
                echo "  Would pull latest changes from remote"
            fi
            ;;

        push)
            echo "📤 Pushing namespace data to Git..."

            if [[ "$DRY_RUN" != "true" ]]; then
                # First sync local data
                bash "$GIT_SYNC_SCRIPT" sync

                # Then push
                if [[ -d "$FLOWFORGE_ROOT/.git" ]]; then
                    cd "$FLOWFORGE_ROOT"
                    git push || {
                        echo "⚠️  Push failed"
                        echo "💡 You may need to pull first: /flowforge:namespace:sync pull"
                        exit 1
                    }
                    echo "✅ Push complete"
                fi
            else
                echo "  Would push local changes to remote"
            fi
            ;;

        migrate)
            echo "🔄 Migrating to Git-based namespace..."

            if [[ "$DRY_RUN" != "true" ]]; then
                if [[ -n "$MIGRATE_SCRIPT" ]] && [[ -f "$MIGRATE_SCRIPT" ]]; then
                    bash "$MIGRATE_SCRIPT"
                    echo "✅ Migration complete"
                else
                    echo "❌ Migration script not found"
                    exit 1
                fi
            else
                echo "  Would migrate:"
                echo "    • Create namespace structure"
                echo "    • Initialize Git tracking"
                echo "    • Migrate existing data"
            fi
            ;;

        status)
            show_sync_status
            ;;

        *)
            echo "❌ Unknown action: $SYNC_ACTION"
            exit 1
            ;;
    esac
}
```

## 📊 Main Execution
```bash
# Execute based on action
if [[ "$SYNC_ACTION" == "status" ]]; then
    show_sync_status
else
    perform_sync
fi

echo ""

# Show post-sync status for non-status actions
if [[ "$SYNC_ACTION" != "status" ]] && [[ "$DRY_RUN" != "true" ]]; then
    echo "📊 Post-Sync Status:"
    echo "==================="

    # Quick status check
    local dev_dir="$FLOWFORGE_ROOT/developers/$DEVELOPER_ID"

    if [[ -f "$dev_dir/profile.json" ]]; then
        local last_synced=$(jq -r '.last_synced // "never"' "$dev_dir/profile.json")
        echo "✅ Last sync: $last_synced"
    fi

    # Check Git status
    if [[ -d "$FLOWFORGE_ROOT/.git" ]]; then
        cd "$FLOWFORGE_ROOT"

        if git diff --quiet 2>/dev/null; then
            echo "✅ Clean working directory"
        else
            echo "⚠️  Uncommitted changes remain"
        fi
    fi
fi

echo ""
echo "✅ Namespace sync operation complete"
```

## 📋 Exit
```bash
exit 0
```