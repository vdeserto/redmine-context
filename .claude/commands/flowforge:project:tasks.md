# Command: flowforge:project:tasks
# Version: 2.0.0
# Description: FlowForge project tasks command

---
description: Generate comprehensive task reports filtered by time, milestone, or assignee
argument-hint: "[filter] [options] (try 'tasks ?' for help)"
---

# 📋 Task Report Generation

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
    if [[ "${BASH_COMMAND:-}" =~ "check-feature-flag" ]]; then
        echo "💡 Feature flag check failed - ensure FlowForge is properly installed"
    elif [[ "${BASH_COMMAND:-}" =~ "generate-report" ]]; then
        echo "💡 Report generation failed - check script permissions and arguments"
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
📋 FlowForge Task Reports

Generate comprehensive task reports from GitHub issues.

Usage: /flowforge:project:tasks [filter] [options]

Filters:
  today         Tasks with due date today
  tomorrow      Tasks with due date tomorrow  
  week          Tasks due this week
  next-week     Tasks due next week
  milestone     Current milestone tasks
  milestone N   Specific milestone N tasks
  all           All open tasks (excluding icebox)
  help, ?       Show this help

Options:
  --mine        Only tasks assigned to me
  --all         All team members' tasks (default)
  --no-cleanup  Don't cleanup old reports
  --clear-cache Clear API cache before running

Examples:
  /flowforge:project:tasks today
  /flowforge:project:tasks tomorrow --mine
  /flowforge:project:tasks milestone 2 --mine
  /flowforge:project:tasks week --all

Output:
  Generates reports in ffReports/daily/ directory
  Reports older than 7 days are automatically cleaned up

Requires:
  - GitHub CLI (gh) installed and authenticated
  - .flowforge/scripts/tasks/generate-report.sh script
EOF
    exit 0
fi
```

## 🔍 Check Feature Flag
```bash
# Check if tasks command is enabled
echo "🔍 Checking feature status..."

# Check if feature flag script exists
if [ ! -f ".flowforge/scripts/check-feature-flag.sh" ]; then
    echo "⚠️  Feature flag check script not found"
    echo "   Assuming tasks command is enabled"
    FEATURE_STATUS="enabled"
else
    # Run feature check with error handling
    FEATURE_STATUS=$(.flowforge/scripts/check-feature-flag.sh tasks_command 2>&1) || {
        echo "❌ The /tasks command is currently disabled"
        echo "💡 Enable it in .flowforge/config.json under features.tasks_command.enabled"
        echo ""
        echo "To enable, add to .flowforge/config.json:"
        echo '  "features": {'
        echo '    "tasks_command": {'
        echo '      "enabled": true'
        echo '    }'
        echo '  }'
        exit 1
    }
fi

# Show experimental warning if needed
if echo "$FEATURE_STATUS" | grep -q "experimental"; then
    echo "⚠️  Note: /tasks command is experimental and may change"
    echo ""
fi
```

## 🔍 Validate Environment
```bash
# Check prerequisites
echo "🔍 Validating environment..."

# Check for GitHub CLI
if ! command -v gh &> /dev/null; then
    echo "⚠️  Warning: GitHub CLI not found"
    echo "   Reports will have limited functionality"
    echo "   Install from: https://cli.github.com/"
fi

# Check GitHub authentication
if command -v gh &> /dev/null && ! gh auth status &> /dev/null; then
    echo "⚠️  Warning: GitHub CLI not authenticated"
    echo "   Run: gh auth login"
fi

# Find the tasks script
TASKS_SCRIPT=""
if [ -f ".flowforge/scripts/tasks/generate-report.sh" ]; then
    TASKS_SCRIPT=".flowforge/scripts/tasks/generate-report.sh"
elif [ -f "scripts/tasks/generate-report.sh" ]; then
    TASKS_SCRIPT="scripts/tasks/generate-report.sh"
else
    echo "❌ Error: Could not find tasks report generator script"
    echo ""
    echo "Expected locations:"
    echo "  - .flowforge/scripts/tasks/generate-report.sh"
    echo "  - scripts/tasks/generate-report.sh"
    echo ""
    echo "💡 This script should be part of your FlowForge installation"
    echo "   Try running: /flowforge:project:setup"
    exit 1
fi

# Check script is executable
if [ ! -x "$TASKS_SCRIPT" ]; then
    echo "⚠️  Script not executable, fixing permissions..."
    chmod +x "$TASKS_SCRIPT" || {
        echo "❌ Failed to make script executable"
        echo "   Run manually: chmod +x $TASKS_SCRIPT"
        exit 1
    }
fi
```

## 🚀 Execute Task Report Generator
```bash
echo "📊 Generating task report..."

# Parse arguments for provider system
FILTER="${ARGUMENTS:-all}"
OPTIONS=""

# Check for options in arguments
if echo "$FILTER" | grep -q "\-\-"; then
    OPTIONS=$(echo "$FILTER" | grep -oE "\-\-[^ ]+" | tr '\n' ' ')
    FILTER=$(echo "$FILTER" | sed 's/\-\-[^ ]*//g' | xargs)
fi

# Use provider system if available
if [ "$USE_PROVIDER" = "true" ]; then
    echo "Using provider system for task report..."
    
    # Build filter based on arguments
    PROVIDER_FILTER=""
    case "$FILTER" in
        today|tomorrow|week|next-week)
            # These require date filtering which provider may not support
            echo "⚠️  Date-based filters not yet supported in provider system"
            echo "   Showing all open tasks instead"
            PROVIDER_FILTER="--status=open"
            ;;
        milestone*)
            # Extract milestone number if provided
            MILESTONE_NUM=$(echo "$FILTER" | grep -oE '[0-9]+' || echo "")
            if [ -n "$MILESTONE_NUM" ]; then
                PROVIDER_FILTER="--milestone=$MILESTONE_NUM"
            fi
            ;;
        all)
            # Show all open tasks
            PROVIDER_FILTER="--status=open"
            ;;
        *)
            # Try to interpret as status filter
            PROVIDER_FILTER="--status=$FILTER"
            ;;
    esac
    
    # Check for --mine option
    if echo "$OPTIONS" | grep -q "mine"; then
        PROVIDER_FILTER="$PROVIDER_FILTER --assignee=$(whoami)"
    fi
    
    # Generate report file
    REPORT_FILE="ffReports/daily/$(date +%Y-%m-%d).md"
    mkdir -p ffReports/daily
    
    # Create markdown report header
    cat > "$REPORT_FILE" << EOF
# 📋 Task Report

**Generated**: $(date '+%Y-%m-%d %H:%M:%S')
**Filter**: $FILTER $OPTIONS
**Source**: Provider System

---

EOF
    
    # Get tasks from provider and append to report
    if node "$PROVIDER_BRIDGE" list-tasks $PROVIDER_FILTER --format=markdown >> "$REPORT_FILE" 2>/dev/null; then
        echo "✅ Report generated via provider system"
    else
        echo "⚠️  Provider query failed, trying fallback..."
        USE_PROVIDER="false"
    fi
fi

# Fallback to traditional script if provider failed or unavailable
if [ "$USE_PROVIDER" = "false" ] && [ -n "$TASKS_SCRIPT" ]; then
    if ! $TASKS_SCRIPT $ARGUMENTS; then
        echo ""
        echo "❌ Report generation failed"
        echo ""
        echo "💡 Common issues:"
        echo "  - No GitHub repository in current directory"
        echo "  - GitHub CLI not authenticated (run: gh auth login)"
        echo "  - Invalid filter or options provided"
        echo "  - No issues matching the filter criteria"
        echo ""
        echo "Run with '?' for help: /flowforge:project:tasks ?"
        exit 1
    fi
fi
```

## 📝 Post-Generation Actions
```bash
# Ensure report directory exists
mkdir -p ffReports/daily

# Check if report was generated
REPORT_FILE="ffReports/daily/$(date +%Y-%m-%d).md"
if [ -f "$REPORT_FILE" ]; then
    # Get file size for info
    FILE_SIZE=$(wc -c < "$REPORT_FILE" 2>/dev/null || echo "0")
    
    if [ "$FILE_SIZE" -gt 0 ]; then
        echo ""
        echo "✅ Report generated successfully!"
        echo "   File: $REPORT_FILE ($(wc -l < "$REPORT_FILE") lines)"
        echo ""
        echo "💡 Tips:"
        echo "  • View report: cat $REPORT_FILE"
        echo "  • Search report: grep 'pattern' $REPORT_FILE"
        echo "  • Share report: Upload to GitHub Gist or Slack"
        echo "  • Archive report: mv $REPORT_FILE ffReports/adhoc/"
        echo "  • Open in editor: ${EDITOR:-nano} $REPORT_FILE"
    else
        echo ""
        echo "⚠️  Report file is empty"
        echo "   This might mean no tasks matched your filter"
        echo "   Try: /flowforge:project:tasks all"
    fi
else
    echo ""
    echo "⚠️  Report generation may have failed"
    echo "   Check error messages above for details"
    echo ""
    echo "💡 Debug steps:"
    echo "  1. Run with debug: DEBUG=1 /flowforge:project:tasks"
    echo "  2. Check script directly: $TASKS_SCRIPT help"
    echo "  3. Verify GitHub access: gh issue list"
fi

# Show next steps based on content
if [ -f "$REPORT_FILE" ] && grep -q "in-progress" "$REPORT_FILE" 2>/dev/null; then
    echo ""
    echo "📌 You have tasks in progress!"
    echo "   Resume work: /flowforge:session:start"
fi
```

## 🔧 Debug Information
```bash
# Show debug info if enabled
if [[ "${DEBUG:-0}" == "1" ]]; then
    echo ""
    echo "🔍 Debug Information:"
    echo "  Script: $TASKS_SCRIPT"
    echo "  Arguments: ${ARGUMENTS:-none}"
    echo "  Feature status: $FEATURE_STATUS"
    echo "  Report file: $REPORT_FILE"
    echo "  Working directory: $(pwd)"
    if [ -f "$REPORT_FILE" ]; then
        echo "  Report size: $(wc -c < "$REPORT_FILE") bytes"
    fi
fi
```