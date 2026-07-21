# Command: flowforge:bug:add
# Version: 2.0.0
# Description: FlowForge bug add command

---
description: Smart bug addition command with auto-detection of context, priority assignment, and integration with sidetracking system
argument-hint: "[title] [priority:critical|high|medium|low] [--description=\"...\"] [--tags=\"...\"]"
---

# 🐛 Smart Bug Addition - Context-Aware Bug Logging

## 📋 Intelligent Bug Registration System
```bash
set -euo pipefail

# Error handler
handle_error() {
    local exit_code=$?
    local line_number=$1
    echo "❌ Bug addition failed on line $line_number (exit code: $exit_code)"
    echo "💡 Debug with: DEBUG=1 /flowforge:bug:add [title]"
    
    # Clean up temporary files
    if [ -n "${TEMP_FILES:-}" ]; then
        for temp_file in $TEMP_FILES; do
            [ -f "$temp_file" ] && rm -f "$temp_file"
        done
    fi
    
    exit $exit_code
}
trap 'handle_error $LINENO' ERR

# Debug mode
[[ "${DEBUG:-0}" == "1" ]] && set -x

# Check for help request
if [[ "${ARGUMENTS:-}" == "?" || "${ARGUMENTS:-}" == "help" ]]; then
    cat << 'HELP'
🐛 FlowForge Smart Bug Addition

Usage: /flowforge:bug:add [title] [priority] [options]

What it does:
✓ Auto-detects current context (task, branch, files)
✓ Assigns priority based on keywords and context
✓ Creates GitHub issue with rich context
✓ Adds to bug backlog for later processing
✓ Integrates with sidetracking system for immediate fixes
✓ Rich formatted output with actionable options

Arguments:
  [title]     Bug title (interactive if not provided)
  [priority]  critical|high|medium|low (auto-detected if not provided)

Options:
  --description="text"    Bug description
  --tags="tag1,tag2"     Additional tags  
  --files="path1,path2"  Related files (auto-detected)
  --assignee="user"      Assign to specific user
  --milestone="name"     Associate with milestone
  --immediate            Sidetrack immediately after creation

Auto-detection features:
• Current task and branch context
• Files currently being worked on
• Priority based on keywords (crash, security, performance, etc.)
• Related issues and dependencies
• Suggested tags based on file types and context

Priority Keywords:
• Critical: crash, security, vulnerability, production, down, broken
• High: performance, slow, timeout, error, exception, fail  
• Medium: bug, issue, incorrect, wrong, missing
• Low: cosmetic, ui, ux, enhancement, suggestion

Examples:
  /flowforge:bug:add                                      # Interactive mode
  /flowforge:bug:add "Login button not working"          # Quick add with auto-detection
  /flowforge:bug:add "Database timeout" critical         # Explicit priority
  /flowforge:bug:add "UI spacing issue" low --immediate  # Add and fix immediately
  /flowforge:bug:add "API error" --description="500 error on POST /users" --tags="api,backend"

Integration:
• GitHub Issues for tracking
• Sidetracking system for immediate fixes  
• Time tracking for accurate billing
• Task management for workflow integration
HELP
    exit 0
fi


# Source utility functions for validation and detection
# Try multiple paths to find the bug directory
if [ -d "commands/flowforge/bug" ]; then
    BUG_DIR="commands/flowforge/bug"
elif [ -d "../commands/flowforge/bug" ]; then
    BUG_DIR="../commands/flowforge/bug"
elif [ -d "../../commands/flowforge/bug" ]; then
    BUG_DIR="../../commands/flowforge/bug"
elif [ -d "${HOME}/projects/dev/cruzalex/flowforge/FlowForge/commands/flowforge/bug" ]; then
    BUG_DIR="${HOME}/projects/dev/cruzalex/flowforge/FlowForge/commands/flowforge/bug"
else
    BUG_DIR="$(dirname "${BASH_SOURCE[0]:-$0}")"
fi

# Source utility file
if [ -f "$BUG_DIR/add-github-utils.sh" ]; then
    source "$BUG_DIR/add-github-utils.sh"
else
    echo "⚠️  GitHub utilities not found - some features may be limited"
fi
echo "🐛 Smart Bug Addition - Context-Aware Registration"
echo "════════════════════════════════════════════════"
```

## 🎯 Step 1: Parse Arguments and Options
```bash
# Parse command line arguments
ARGS=()
TITLE=""
PRIORITY=""
DESCRIPTION=""
TAGS=""
FILES=""
ASSIGNEE=""
MILESTONE=""
IMMEDIATE=false

# Parse arguments manually to handle complex options
while [[ $# -gt 0 ]]; do
    case $1 in
        --description=*)
            DESCRIPTION="${1#*=}"
            shift
            ;;
        --tags=*)
            TAGS="${1#*=}"
            shift
            ;;
        --files=*)
            FILES="${1#*=}"
            shift
            ;;
        --assignee=*)
            ASSIGNEE="${1#*=}"
            shift
            ;;
        --milestone=*)
            MILESTONE="${1#*=}"
            shift
            ;;
        --immediate)
            IMMEDIATE=true
            shift
            ;;
        --*)
            echo "⚠️  Unknown option: $1"
            shift
            ;;
        *)
            ARGS+=("$1")
            shift
            ;;
    esac
done

# Extract positional arguments
if [ ${#ARGS[@]} -gt 0 ]; then
    TITLE="${ARGS[0]}"
fi

if [ ${#ARGS[@]} -gt 1 ]; then
    PRIORITY="${ARGS[1]}"
fi

echo "🔍 Parsed Arguments:"
echo "• Title: ${TITLE:-'(will prompt)'}"
echo "• Priority: ${PRIORITY:-'(will auto-detect)'}"
echo "• Immediate fix: $IMMEDIATE"
if [ -n "$DESCRIPTION" ]; then echo "• Description: $DESCRIPTION"; fi
if [ -n "$TAGS" ]; then echo "• Tags: $TAGS"; fi
```

## 🎯 Step 2: Auto-Detect Current Context
```bash
echo "🔍 Auto-detecting current context..."

# Current git context
CURRENT_BRANCH=""
CURRENT_TASK=""
CURRENT_COMMIT=""
if git rev-parse --git-dir > /dev/null 2>&1; then
    CURRENT_BRANCH=$(git branch --show-current 2>/dev/null || echo "unknown")
    CURRENT_COMMIT=$(git log -1 --format="%h %s" 2>/dev/null || echo "No commits")
    
    # Extract current task from branch name
    if [[ "$CURRENT_BRANCH" =~ feature/([0-9]+)- ]]; then
        CURRENT_TASK="${BASH_REMATCH[1]}"
    elif [[ "$CURRENT_BRANCH" =~ (bugfix|hotfix)/([^-]+)- ]]; then
        CURRENT_TASK="${BASH_REMATCH[2]}"
    fi
else
    echo "⚠️  Not in a git repository!"
    CURRENT_BRANCH="unknown"
fi

# Auto-detect files being worked on
DETECTED_FILES=()
MODIFIED_FILES=""

if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
    echo "📁 Detecting modified files..."
    while IFS= read -r line; do
        if [[ "$line" =~ ^[MAR?] ]]; then
            FILE_PATH=$(echo "$line" | cut -c4-)
            DETECTED_FILES+=("$FILE_PATH")
            if [ -z "$MODIFIED_FILES" ]; then
                MODIFIED_FILES="$FILE_PATH"
            else
                MODIFIED_FILES="$MODIFIED_FILES,$FILE_PATH"
            fi
        fi
    done <<< "$(git status --porcelain 2>/dev/null)"
fi

# Override with provided files or use detected
if [ -n "$FILES" ]; then
    FILES_TO_USE="$FILES"
else
    FILES_TO_USE="$MODIFIED_FILES"
fi

# Detect file types for auto-tagging
DETECTED_TAGS=()
if [ -n "$FILES_TO_USE" ]; then
    IFS=',' read -ra FILE_ARRAY <<< "$FILES_TO_USE"
    for file in "${FILE_ARRAY[@]}"; do
        case "$file" in
            *.js|*.ts|*.jsx|*.tsx) DETECTED_TAGS+=("frontend" "javascript") ;;
            *.py) DETECTED_TAGS+=("backend" "python") ;;
            *.go) DETECTED_TAGS+=("backend" "golang") ;;
            *.java) DETECTED_TAGS+=("backend" "java") ;;
            *.css|*.scss|*.sass) DETECTED_TAGS+=("ui" "styling") ;;
            *.html|*.vue) DETECTED_TAGS+=("frontend" "ui") ;;
            *.md|*.rst) DETECTED_TAGS+=("documentation") ;;
            *.sql) DETECTED_TAGS+=("database") ;;
            *.json|*.yaml|*.yml) DETECTED_TAGS+=("configuration") ;;
            *test*|*spec*) DETECTED_TAGS+=("testing") ;;
        esac
    done
fi

# Remove duplicates from detected tags
DETECTED_TAGS=($(printf "%s\n" "${DETECTED_TAGS[@]}" | sort -u))

echo "📍 Context Detection Results:"
echo "• Branch: $CURRENT_BRANCH"
echo "• Task: ${CURRENT_TASK:-'none detected'}"
echo "• Last commit: $CURRENT_COMMIT"
echo "• Modified files: ${FILES_TO_USE:-'none'}"
echo "• Detected tags: ${DETECTED_TAGS[*]:-'none'}"
```

## 🎯 Step 3: Interactive Bug Input (if needed)
```bash
# Get bug title if not provided
if [ -z "$TITLE" ]; then
    echo ""
    echo "📝 Bug Information Required:"
    
    if [ -t 0 ]; then
        echo -n "Bug title: "
        read -r TITLE
        
        if [ -z "$TITLE" ]; then
            echo "❌ Bug title is required"
            exit 1
        fi
    else
        echo "❌ Bug title required in non-interactive mode"
        echo "💡 Usage: /flowforge:bug:add \"Bug title\" [priority]"
        exit 1
    fi
fi

# Get description if not provided and in interactive mode
if [ -z "$DESCRIPTION" ] && [ -t 0 ]; then
    echo -n "Description (optional, press Enter to skip): "
    read -r DESCRIPTION
fi

echo "📝 Bug Title: $TITLE"
if [ -n "$DESCRIPTION" ]; then
    echo "📄 Description: $DESCRIPTION"
fi
```

## 🎯 Step 4: Smart Priority Detection
```bash
echo "🧠 Analyzing priority..."

DETECTED_PRIORITY=""
PRIORITY_REASON=""

# Keyword-based priority detection
TITLE_LOWER=$(echo "$TITLE" | tr '[:upper:]' '[:lower:]')
DESC_LOWER=$(echo "$DESCRIPTION" | tr '[:upper:]' '[:lower:]')
COMBINED_TEXT="$TITLE_LOWER $DESC_LOWER"

# Critical keywords
if [[ "$COMBINED_TEXT" =~ (crash|security|vulnerability|production|down|broken|critical|urgent|emergency) ]]; then
    DETECTED_PRIORITY="critical"
    PRIORITY_REASON="Contains critical keywords: crash, security, production, etc."
# High priority keywords
elif [[ "$COMBINED_TEXT" =~ (performance|slow|timeout|error|exception|fail|high|important|blocking) ]]; then
    DETECTED_PRIORITY="high"
    PRIORITY_REASON="Contains high priority keywords: performance, error, blocking, etc."
# Medium priority keywords
elif [[ "$COMBINED_TEXT" =~ (bug|issue|incorrect|wrong|missing|medium|problem) ]]; then
    DETECTED_PRIORITY="medium"
    PRIORITY_REASON="Contains standard bug keywords: incorrect, wrong, missing, etc."
# Low priority keywords
elif [[ "$COMBINED_TEXT" =~ (cosmetic|ui|ux|enhancement|suggestion|low|minor|trivial) ]]; then
    DETECTED_PRIORITY="low"
    PRIORITY_REASON="Contains low priority keywords: cosmetic, ui, minor, etc."
else
    DETECTED_PRIORITY="medium"
    PRIORITY_REASON="Default priority (no specific keywords detected)"
fi

# Use provided priority or detected priority
if [ -n "$PRIORITY" ]; then
    case "$PRIORITY" in
        critical|high|medium|low)
            FINAL_PRIORITY="$PRIORITY"
            echo "✅ Using provided priority: $FINAL_PRIORITY"
            ;;
        *)
            FINAL_PRIORITY="$DETECTED_PRIORITY"
            echo "⚠️  Invalid priority '$PRIORITY' - using detected: $FINAL_PRIORITY"
            ;;
    esac
else
    FINAL_PRIORITY="$DETECTED_PRIORITY"
    echo "🔍 Auto-detected priority: $FINAL_PRIORITY"
    echo "  Reason: $PRIORITY_REASON"
    
    # Confirm in interactive mode
    if [ -t 0 ]; then
        echo -n "Accept priority '$FINAL_PRIORITY'? [Y/n]: "
        read -r CONFIRM
        if [[ $CONFIRM =~ ^[Nn]$ ]]; then
            echo "Select priority:"
            echo "1) Critical (production down, security issue)"
            echo "2) High (major feature broken, performance issue)"  
            echo "3) Medium (standard bug, incorrect behavior)"
            echo "4) Low (cosmetic, minor enhancement)"
            echo -n "Choice [1-4]: "
            read -r PRIORITY_CHOICE
            
            case "$PRIORITY_CHOICE" in
                1) FINAL_PRIORITY="critical" ;;
                2) FINAL_PRIORITY="high" ;;
                3) FINAL_PRIORITY="medium" ;;
                4) FINAL_PRIORITY="low" ;;
                *) echo "⚠️  Invalid choice - keeping detected priority: $FINAL_PRIORITY" ;;
            esac
        fi
    fi
fi
```

## 🎯 Step 5: Combine and Prepare Tags
```bash
echo "🏷️  Preparing tags..."

FINAL_TAGS=("bug" "$FINAL_PRIORITY")

# Add detected tags from file analysis
FINAL_TAGS+=("${DETECTED_TAGS[@]}")

# Add user-provided tags
if [ -n "$TAGS" ]; then
    IFS=',' read -ra USER_TAGS <<< "$TAGS"
    for tag in "${USER_TAGS[@]}"; do
        # Trim whitespace
        tag=$(echo "$tag" | xargs)
        if [ -n "$tag" ]; then
            FINAL_TAGS+=("$tag")
        fi
    done
fi

# Remove duplicates and sort
FINAL_TAGS=($(printf "%s\n" "${FINAL_TAGS[@]}" | sort -u))

echo "🏷️  Final tags: ${FINAL_TAGS[*]}"
```

## 🎯 Step 6: Create Comprehensive Bug Description
```bash
echo "📄 Building comprehensive bug report..."

# Build rich description using utility function
FULL_DESCRIPTION=$(build_github_description "$DESCRIPTION" "$CURRENT_TASK" "$CURRENT_BRANCH" "$CURRENT_COMMIT" "$FILES_TO_USE" "$PRIORITY_REASON")
```

## 🎯 Step 7: Create GitHub Issue
```bash
echo "📋 Creating GitHub issue..."

# Use utility function to create GitHub issue
if create_github_issue "$TITLE" "$FULL_DESCRIPTION" FINAL_TAGS "$ASSIGNEE" "$MILESTONE"; then
    CREATION_SUCCESS=true
    ISSUE_URL="$GITHUB_ISSUE_URL"
    ISSUE_NUMBER="$GITHUB_ISSUE_NUMBER"
    echo "✅ Issue created successfully"
else
    CREATION_SUCCESS=false
    ISSUE_URL=""
    ISSUE_NUMBER=""
fi
```

## 🎯 Step 8: Add to Bug Backlog
```bash
echo "📋 Adding to bug backlog..."

# Create/update bug backlog file
BUG_BACKLOG_FILE=".flowforge/bug-backlog.json"
mkdir -p ".flowforge"

# Initialize backlog file if it doesn't exist
if [ ! -f "$BUG_BACKLOG_FILE" ]; then
    echo '{"bugs": []}' > "$BUG_BACKLOG_FILE"
fi

# Create bug entry
BUG_ENTRY=$(cat << EOF
{
  "id": "${ISSUE_NUMBER:-$(date +%s)}",
  "title": "$TITLE",
  "priority": "$FINAL_PRIORITY",
  "description": "$DESCRIPTION",
  "tags": [$(printf '"%s",' "${FINAL_TAGS[@]}" | sed 's/,$//')],
  "context": {
    "task": "${CURRENT_TASK:-}",
    "branch": "$CURRENT_BRANCH",
    "files": [$(echo "$FILES_TO_USE" | sed 's/,/","/g' | sed 's/^/"/;s/$/"/' | sed 's/""//g')],
    "commit": "$CURRENT_COMMIT"
  },
  "github": {
    "url": "${ISSUE_URL:-}",
    "number": "${ISSUE_NUMBER:-}"
  },
  "created": "$(date -Iseconds)",
  "status": "open",
  "estimatedTime": null,
  "assignee": "${ASSIGNEE:-}"
}
EOF
)

# Add to backlog using jq if available
if command -v jq >/dev/null 2>&1; then
    # Use jq to properly add the entry
    TEMP_FILE=$(mktemp)
    jq ".bugs += [$BUG_ENTRY]" "$BUG_BACKLOG_FILE" > "$TEMP_FILE" && mv "$TEMP_FILE" "$BUG_BACKLOG_FILE"
    echo "✅ Added to bug backlog (JSON format)"
else
    # Fallback to simple append (less robust)
    echo "⚠️  jq not available - using basic format"
    cat >> ".flowforge/bug-backlog.txt" << EOF

# Bug: $TITLE
ID: ${ISSUE_NUMBER:-$(date +%s)}
Priority: $FINAL_PRIORITY
Created: $(date -Iseconds)
Context: Task ${CURRENT_TASK:-unknown} on $CURRENT_BRANCH
URL: ${ISSUE_URL:-not_created}
Tags: ${FINAL_TAGS[*]}
Files: $FILES_TO_USE
Description: $DESCRIPTION
---
EOF
    echo "✅ Added to bug backlog (text format)"
fi
```

## 🎯 Step 9: Integration with Task Management
```bash
echo "📊 Integrating with task management..."

# Update tasks.json via provider-bridge
if [ -f ".flowforge/tasks.json" ] || command -v node &>/dev/null; then
    echo "📝 Updating tasks.json..."
    
    # Create task via provider-bridge
    TASK_ID=$(node scripts/provider-bridge.js create-task \
        --title="Bug: $TITLE" \
        --description="$DESCRIPTION" \
        --status="todo" \
        --priority="$FINAL_PRIORITY" \
        --labels="type:bug,priority:$FINAL_PRIORITY" \
        --format=simple 2>/dev/null || echo "TBD")
    
    if [ "$TASK_ID" != "TBD" ]; then
        echo "✅ Added bug to tasks.json (ID: $TASK_ID)"
    else
        echo "⚠️  Could not add to tasks.json"
    fi
fi

# Update project statistics
if [ -f ".flowforge/project-stats.json" ] && command -v jq >/dev/null 2>&1; then
    TEMP_FILE=$(mktemp)
    jq "
        .bugs.total += 1 |
        .bugs.by_priority.$FINAL_PRIORITY += 1 |
        .bugs.last_added = \"$(date -Iseconds)\"
    " ".flowforge/project-stats.json" > "$TEMP_FILE" 2>/dev/null && mv "$TEMP_FILE" ".flowforge/project-stats.json" || rm -f "$TEMP_FILE"
fi
```

## 🎯 Step 10: Immediate Sidetrack Option
```bash
if [ "$IMMEDIATE" = true ]; then
    echo ""
    echo "🚀 IMMEDIATE FIX REQUESTED"
    echo "════════════════════════════════════════════════════"
    echo ""
    echo "🔄 Initiating bug sidetrack for immediate fix..."
    
    if [ -n "$ISSUE_NUMBER" ]; then
        echo "💡 Running: /flowforge:bug:nobugbehind $ISSUE_NUMBER $FINAL_PRIORITY"
        
        # Set up arguments for nobugbehind command
        export ARGUMENTS="$ISSUE_NUMBER $FINAL_PRIORITY"
        
        # Execute nobugbehind command
        NOBUGBEHIND_PATH="commands/flowforge/bug/nobugbehind.md"
        if [ -f "$NOBUGBEHIND_PATH" ]; then
            echo "🚀 Switching to bug fixing mode..."
            
            # Extract and run bash code from nobugbehind
            INSIDE_BASH=0
            TEMP_SCRIPT="/tmp/nobugbehind_$$.sh"
            > "$TEMP_SCRIPT"
            
            while IFS= read -r line; do
                if [[ "$line" == '```bash' ]]; then
                    INSIDE_BASH=1
                elif [[ "$line" == '```' ]] && [ $INSIDE_BASH -eq 1 ]; then
                    INSIDE_BASH=0
                elif [ $INSIDE_BASH -eq 1 ]; then
                    echo "$line" >> "$TEMP_SCRIPT"
                fi
            done < "$NOBUGBEHIND_PATH"
            
            if [ -s "$TEMP_SCRIPT" ]; then
                bash "$TEMP_SCRIPT"
                rm -f "$TEMP_SCRIPT"
            else
                echo "❌ Could not execute nobugbehind command"
            fi
        else
            echo "❌ nobugbehind command not found at $NOBUGBEHIND_PATH"
            echo "💡 Run manually: /flowforge:bug:nobugbehind $ISSUE_NUMBER $FINAL_PRIORITY"
        fi
    else
        echo "⚠️  Cannot sidetrack immediately - no issue number available"
        echo "💡 Create the GitHub issue first, then run: /flowforge:bug:nobugbehind [issue-number]"
    fi
else
    # Display completion summary
    echo ""
    echo "════════════════════════════════════════════════════"
    echo "✅ BUG ADDED SUCCESSFULLY"
    echo "════════════════════════════════════════════════════"
    echo ""
    echo "📋 Bug Summary:"
    echo "• Title: $TITLE"
    echo "• Priority: $FINAL_PRIORITY ($PRIORITY_REASON)"
    if [ -n "$ISSUE_NUMBER" ]; then
        echo "• Issue: #$ISSUE_NUMBER ($ISSUE_URL)"
    fi
    echo "• Tags: ${FINAL_TAGS[*]}"
    echo "• Context: Task ${CURRENT_TASK:-unknown} on $CURRENT_BRANCH"
    echo ""
    
    echo "🔧 Available Actions:"
    echo "• Fix immediately: /flowforge:bug:nobugbehind ${ISSUE_NUMBER:-$TITLE}"
    echo "• View all bugs: /flowforge:bug:list"
    echo "• View issue: gh issue view ${ISSUE_NUMBER:-[number]}"
    echo ""
    
    echo "📊 Bug Backlog Status:"
    if command -v jq >/dev/null 2>&1 && [ -f ".flowforge/bug-backlog.json" ]; then
        TOTAL_BUGS=$(jq '.bugs | length' .flowforge/bug-backlog.json 2>/dev/null || echo "unknown")
        CRITICAL_BUGS=$(jq '.bugs | map(select(.priority == "critical")) | length' .flowforge/bug-backlog.json 2>/dev/null || echo "0")
        echo "• Total bugs: $TOTAL_BUGS"
        echo "• Critical bugs: $CRITICAL_BUGS"
        if [ "$CRITICAL_BUGS" != "0" ]; then
            echo "⚠️  You have $CRITICAL_BUGS critical bugs that need immediate attention!"
        fi
    else
        echo "• Backlog: Updated (use /flowforge:bug:list for details)"
    fi
    
    echo ""
    echo "💡 Rule #37: No Bug Left Behind - Bug tracked and won't be forgotten!"
fi

exit 0
```

## 🎯 Success!

Your bug has been intelligently registered with:

**Smart Detection:**
- Context-aware priority assignment based on keywords
- Auto-detected current task, branch, and file context  
- Intelligent tagging based on file types and content

**Rich Documentation:**
- Comprehensive GitHub issue with context information
- Structured templates for reproduction and testing
- Integration with existing task management

**Workflow Integration:**
- Added to bug backlog for tracking
- Option for immediate sidetracking to fix
- Integration with FlowForge time tracking and project stats

**Next Actions:**
- Use `/flowforge:bug:list` to view and manage all bugs
- Use `/flowforge:bug:nobugbehind [id]` to fix immediately  
- Bugs are tracked and won't be forgotten (Rule #37)

The system ensures every bug is properly documented, prioritized, and integrated into your workflow for efficient resolution.