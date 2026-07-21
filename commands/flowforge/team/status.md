# Command: flowforge:team:status
# Version: 2.0.0
# Description: Show team status from Git-tracked namespace data
# Issue: #548 - Git-Integrated Namespace System

---
description: Display current team status including active developers and task assignments
---

# 👥 FlowForge Team Status

## 🔧 Setup Error Handling
```bash
# Enable strict error handling
set -euo pipefail

# Error handler function
handle_error() {
    local exit_code=$?
    local line_number=$1
    echo "❌ Error on line $line_number (exit code: $exit_code)"

    # Provide helpful error messages based on context
    if [[ "${BASH_COMMAND:-}" =~ "jq" ]]; then
        echo "💡 JSON parsing failed - check data file format"
    elif [[ "${BASH_COMMAND:-}" =~ "git" ]]; then
        echo "💡 Git command failed - ensure repository is configured"
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
👥 FlowForge Team Status

Display real-time team status from Git-tracked namespace data.

Usage: /flowforge:team:status [options]

Options:
  (none)         Show standard team status
  who           Show who's working on what
  activity       Show recent team activity
  --verbose      Show detailed information
  help, ?        Show this help message

Information displayed:
  • Active developers and their status
  • Current task assignments
  • Recent session activity
  • Team collaboration metrics

Examples:
  /flowforge:team:status              # Standard overview
  /flowforge:team:status who          # Task assignments
  /flowforge:team:status activity     # Recent activity
  /flowforge:team:status --verbose    # Detailed view

Related commands:
  /flowforge:team:report    Generate detailed team reports
  /flowforge:session:status  View your session status

EOF
    exit 0
fi
```

## 🔍 Parse Options
```bash
# Initialize options
VERBOSE=false
SHOW_MODE="status"

# Parse arguments
for arg in ${ARGUMENTS:-}; do
    case "$arg" in
        --verbose) VERBOSE=true ;;
        who) SHOW_MODE="who" ;;
        activity) SHOW_MODE="activity" ;;
        --*) echo "⚠️  Unknown option: $arg" ;;
    esac
done
```

## 🛠️ Locate Team Report Script
```bash
# Find the team-report.sh script
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

# Try multiple locations for the script
TEAM_REPORT_SCRIPT=""
for location in \
    "$PROJECT_ROOT/scripts/namespace/team-report.sh" \
    "$SCRIPT_DIR/../../../scripts/namespace/team-report.sh" \
    "$(dirname "$0")/../../../scripts/namespace/team-report.sh"; do
    if [[ -f "$location" ]]; then
        TEAM_REPORT_SCRIPT="$location"
        break
    fi
done

# Verify script found
if [[ -z "$TEAM_REPORT_SCRIPT" ]]; then
    echo "❌ Error: team-report.sh script not found"
    echo "💡 Ensure FlowForge is properly installed"
    exit 1
fi
```

## 📊 Execute Team Status
```bash
# Main execution based on mode
case "$SHOW_MODE" in
    status)
        # Show standard team status
        if [[ "$VERBOSE" == "true" ]]; then
            export DEBUG=1
        fi
        bash "$TEAM_REPORT_SCRIPT" status
        ;;

    who)
        # Show who's working on what
        bash "$TEAM_REPORT_SCRIPT" who
        ;;

    activity)
        # Show recent team activity
        bash "$TEAM_REPORT_SCRIPT" activity today

        if [[ "$VERBOSE" == "true" ]]; then
            echo ""
            echo "📈 Weekly Summary:"
            echo "=================="
            bash "$TEAM_REPORT_SCRIPT" activity week
        fi
        ;;

    *)
        echo "❌ Unknown mode: $SHOW_MODE"
        exit 1
        ;;
esac

# Add integration status if verbose
if [[ "$VERBOSE" == "true" ]]; then
    echo ""
    echo "🔄 Git Integration Status:"
    echo "========================="

    # Check last sync
    FLOWFORGE_ROOT="${FLOWFORGE_ROOT_OVERRIDE:-$PROJECT_ROOT/.flowforge}"
    if [[ -d "$FLOWFORGE_ROOT/.git" ]]; then
        echo "✅ Git tracking enabled"

        # Show last sync commit
        cd "$FLOWFORGE_ROOT"
        LAST_SYNC=$(git log -1 --format="%h %s (%ar)" --grep="sync" 2>/dev/null || echo "No sync commits found")
        echo "📝 Last sync: $LAST_SYNC"

        # Check for uncommitted changes
        if ! git diff --quiet 2>/dev/null; then
            echo "⚠️  Uncommitted namespace changes detected"
        fi
    else
        echo "⚠️  Git tracking not configured for namespace data"
        echo "💡 Run: /flowforge:namespace:sync to enable Git tracking"
    fi
fi

echo ""
echo "✅ Team status retrieved successfully"
```

## 📋 Exit
```bash
exit 0
```