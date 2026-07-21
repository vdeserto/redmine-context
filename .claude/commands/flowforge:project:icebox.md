# Command: flowforge:project:icebox
# Version: 2.0.0
# Description: FlowForge project icebox command

---
description: Show future ideas not assigned to any milestone
argument-hint: "[help]"
---

# 🧊 Icebox - Future Ideas

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
    if [[ "${BASH_COMMAND:-}" =~ "gh issue list" ]]; then
        echo "💡 GitHub CLI failed - check if 'gh' is installed and authenticated"
        echo "   Install: https://cli.github.com/"
        echo "   Authenticate: gh auth login"
    elif [[ "${BASH_COMMAND:-}" =~ "API rate limit" ]]; then
        echo "💡 GitHub API rate limit exceeded"
        echo "   Try again later or authenticate for higher limits"
    elif [[ "${BASH_COMMAND:-}" =~ "failed to connect" ]]; then
        echo "💡 Network connection failed"
        echo "   Check your internet connection and try again"
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
🧊 FlowForge Icebox

Show future ideas and features not assigned to any milestone.

Usage: /flowforge:project:icebox [help]

Arguments:
  help, ?    Show this help message

The icebox contains:
  • Future feature ideas
  • Nice-to-have improvements  
  • Technical debt items
  • Experimental features
  • Ideas that need more planning

To work on an icebox item:
  1. Review the issue: gh issue view <number>
  2. Assign to milestone: gh issue edit <number> --milestone <name>
  3. Update priority: gh issue edit <number> --remove-label "priority: icebox" --add-label "priority: high"
  4. Start work: /startsession <number>

Requires:
  - GitHub CLI (gh) installed and authenticated
  - Git repository with GitHub remote
EOF
    exit 0
fi
```

## 🔍 Validate Environment
```bash
# Check for GitHub CLI
if ! command -v gh &> /dev/null; then
    echo "❌ Error: GitHub CLI not found"
    echo "💡 Install from: https://cli.github.com/"
    echo "   Or use web interface: https://github.com"
    exit 1
fi

# Check GitHub authentication
if ! gh auth status &> /dev/null; then
    echo "❌ Error: Not authenticated with GitHub"
    echo "💡 Run: gh auth login"
    echo "   Or check: gh auth status"
    exit 1
fi

# Check if we're in a git repository
if ! git rev-parse --git-dir &> /dev/null; then
    echo "❌ Error: Not in a git repository"
    echo "💡 Initialize with: git init"
    exit 1
fi

# Check for GitHub remote
if ! gh repo view &> /dev/null; then
    echo "⚠️  Warning: No GitHub remote detected"
    echo "💡 Add remote: git remote add origin <url>"
    echo "   Or create: gh repo create"
fi
```

## 📋 Fetch and Display Icebox Items
```bash
echo "🧊 FlowForge Icebox Items (priority: icebox, no milestone)"
echo "════════════════════════════════════════════════════════"
echo ""

# Fetch icebox issues with error handling
ISSUES=""
FETCH_OUTPUT=""
if ! FETCH_OUTPUT=$(gh issue list \
  --label "priority: icebox" \
  --json number,title,labels,milestone 2>&1); then
    
    # Handle specific error cases
    if [[ "$FETCH_OUTPUT" =~ "API rate limit" ]]; then
        echo "❌ GitHub API rate limit exceeded"
        echo "💡 Try again later or authenticate for higher limits"
        echo "   Check limit: gh api rate_limit"
        exit 1
    elif [[ "$FETCH_OUTPUT" =~ "not authenticated" ]]; then
        echo "❌ GitHub authentication required"
        echo "💡 Run: gh auth login"
        exit 1
    elif [[ "$FETCH_OUTPUT" =~ "failed to connect" || "$FETCH_OUTPUT" =~ "connection" ]]; then
        echo "❌ Network connection failed"
        echo "💡 Check your internet connection"
        exit 1
    else
        echo "❌ Failed to fetch issues: $FETCH_OUTPUT"
        exit 1
    fi
fi

# Parse the JSON to filter for issues without milestones
if [[ "$FETCH_OUTPUT" == "[]" ]]; then
    # Empty array - no issues at all
    ISSUES=""
elif ! echo "$FETCH_OUTPUT" | jq empty 2>/dev/null; then
    # Invalid JSON
    echo "❌ Error: Invalid response format from GitHub"
    echo "💡 This might be a temporary issue. Try again later."
    echo "   Debug: $FETCH_OUTPUT"
    exit 1
else
    # Filter for issues without milestones
    ISSUES=$(echo "$FETCH_OUTPUT" | jq -r '.[] | select(.milestone == null)' 2>/dev/null || echo "")
fi

# Check if we have any icebox items
if [[ -z "$ISSUES" || "$ISSUES" == "" ]]; then
    echo "📭 No items in the icebox!"
    echo ""
    echo "💡 To add items to the icebox:"
    echo "   1. Create an issue with important future ideas"
    echo "   2. Label it with 'priority: icebox'"
    echo "   3. Don't assign it to any milestone"
else
    # Display issues with proper formatting
    if ! gh issue list \
        --label "priority: icebox" \
        --json number,title,labels,milestone,createdAt \
        --jq '.[] | select(.milestone == null) | "• #\(.number) - \(.title)"' 2>/dev/null | sort -n; then
        
        echo "⚠️  Error formatting issue list"
        echo "💡 Falling back to simple format..."
        
        # Fallback display
        gh issue list --label "priority: icebox" --limit 50 2>/dev/null || {
            echo "❌ Failed to display issues"
            exit 1
        }
    fi
    
    echo ""
    echo "════════════════════════════════════════════════════════"
    
    # Count total items
    COUNT=0
    if COUNT=$(gh issue list \
        --label "priority: icebox" \
        --json number,milestone \
        --jq '[.[] | select(.milestone == null)] | length' 2>/dev/null); then
        echo "📊 Total: $COUNT icebox items"
    else
        echo "📊 Total: Unable to count items"
    fi
fi

echo ""
echo "💡 To work on an icebox item:"
echo "   1. Review the issue details: gh issue view <number>"
echo "   2. Assign to a milestone: gh issue edit <number> --milestone <name>"
echo "   3. Update priority: gh issue edit <number> --remove-label \"priority: icebox\" --add-label \"priority: high\""
echo "   4. Start work: /startsession <number>"

# Debug info
if [[ "${DEBUG:-0}" == "1" ]]; then
    echo ""
    echo "🔍 Debug Info:"
    echo "  GitHub CLI: $(which gh)"
    echo "  Authenticated: $(gh auth status &>/dev/null && echo "Yes" || echo "No")"
    echo "  Repository: $(git remote get-url origin 2>/dev/null || echo "No remote")"
fi
```

## 📚 What is the Icebox?

The **icebox** is a kanban concept for storing valuable ideas that aren't immediate priorities. These are:

- ✨ Great features that need more planning
- 💡 Innovative ideas for future versions  
- 🔧 Nice-to-have improvements
- 📚 Technical debt items
- 🚀 Experimental features

### When to use Icebox vs Other Priorities:

| Priority | When to Use | Timeline |
|----------|-------------|----------|
| `critical` | Production issues, security | Immediately |
| `high` | Core features, major bugs | Next sprint |
| `medium` | Planned features | This quarter |
| `low` | Small improvements | When time permits |
| **`icebox`** | **Future possibilities** | **Someday/Maybe** |

### Best Practices:

1. **Regular Review**: Review icebox quarterly
2. **Clear Descriptions**: Document ideas thoroughly  
3. **No Milestone**: Keep unscheduled
4. **Promote When Ready**: Move to active priority when timing is right