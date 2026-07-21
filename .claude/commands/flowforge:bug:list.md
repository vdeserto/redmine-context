# Command: flowforge:bug:list
# Version: 2.0.0
# Description: FlowForge bug list command

---
description: Advanced bug listing command with filtering, rich table formatting, search capability, and export options
argument-hint: "[filter] [--priority=] [--status=] [--assignee=] [--search=] [--format=table|json|markdown] [--export=file]"
---

# 📋 Advanced Bug List Management

## 🔍 Comprehensive Bug Listing and Management System
```bash
set -euo pipefail

# Error handler
handle_error() {
    local exit_code=$?
    local line_number=$1
    echo "❌ Bug listing failed on line $line_number (exit code: $exit_code)"
    echo "💡 Debug with: DEBUG=1 /flowforge:bug:list [options]"
    
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
📋 FlowForge Advanced Bug List Management

Usage: /flowforge:bug:list [filter] [options]

What it does:
✓ Lists bugs with rich formatting and color indicators
✓ Filters by priority, status, assignee, date range
✓ Full-text search across titles and descriptions
✓ Multiple output formats (table, JSON, markdown)
✓ Export capabilities for reporting
✓ Real-time GitHub integration
✓ Sorting and grouping options

Filter Options:
  [filter]           Quick filter: all|open|critical|high|medium|low|mine
  --priority=LIST    Filter by priority: critical,high,medium,low
  --status=LIST      Filter by status: open,closed,in_progress
  --assignee=USER    Filter by assignee (use 'me' for current user)
  --search=TEXT     Search in titles and descriptions
  --tags=LIST       Filter by tags: frontend,backend,ui,etc.
  --since=DATE      Show bugs since date (YYYY-MM-DD or relative like '1 week ago')
  --until=DATE      Show bugs until date

Display Options:
  --format=FORMAT   Output format: table|json|markdown|csv
  --sort=FIELD      Sort by: priority|created|updated|title
  --group=FIELD     Group by: priority|status|assignee|tags
  --limit=N         Limit results (default: 50)
  --color           Force color output (default: auto)
  --no-color        Disable color output

Export Options:

Batch Operations:
  --batch-close       Close all filtered bugs
  --batch-assign=USER Assign all filtered bugs to a user
  --batch-priority=LEVEL Change priority of all filtered bugs (critical|high|medium|low)
  --batch-status=STATUS Change status of all filtered bugs (open|closed|in_progress)
  --force            Skip confirmation prompt for batch operations
  --export=FILE     Export to file (format auto-detected from extension)
  --template=NAME   Use template for export: summary|detailed|report

Examples:
  /flowforge:bug:list                                    # List all open bugs
  /flowforge:bug:list critical                           # Show only critical bugs
  /flowforge:bug:list --assignee=me                      # Show my assigned bugs
  /flowforge:bug:list --search="login" --priority=high   # Search for login-related high priority bugs
  /flowforge:bug:list --since="1 week ago" --format=json # Recent bugs in JSON
  /flowforge:bug:list --export=bugs.csv --template=summary # Export summary to CSV
  /flowforge:bug:list --priority=low --batch-close           # Close all low priority bugs
  /flowforge:bug:list --priority=critical --batch-assign=john # Assign all critical bugs to john
  /flowforge:bug:list --since="30 days ago" --batch-priority=low # Change old bugs to low priority

Interactive Features:
• Color-coded priority indicators
• Real-time GitHub status sync
• Clickable issue URLs (in supported terminals)
• Progress bars for filtered results
• Smart column width adjustment

Integration:
• GitHub Issues for live status updates
• FlowForge bug backlog for local tracking
• Task management system integration  
• Time tracking data inclusion
HELP
    exit 0
fi

echo "📋 FlowForge Bug List Management"
echo "════════════════════════════════════════════════════"

# Source utility functions for complex operations
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

# Source all utility files
for util in list-github-utils.sh list-export-utils.sh list-stats-utils.sh list-table-utils.sh; do
    if [ -f "$BUG_DIR/$util" ]; then
        source "$BUG_DIR/$util"
    else
        echo "⚠️  Missing $util - some features may be limited"
    fi
done
```

## 🎯 Step 1: Parse Command Line Arguments
```bash
# Default values
QUICK_FILTER=""
PRIORITY_FILTER=""
STATUS_FILTER="open"  # Default to open bugs
ASSIGNEE_FILTER=""
SEARCH_FILTER=""
TAGS_FILTER=""
SINCE_FILTER=""
UNTIL_FILTER=""
OUTPUT_FORMAT="table"
SORT_FIELD="priority"
GROUP_FIELD=""
LIMIT=50
USE_COLOR="auto"
EXPORT_FILE=""
TEMPLATE="detailed"

# Temporary files array for cleanup
TEMP_FILES=()

# Parse arguments
ARGS=()
while [[ $# -gt 0 ]]; do
    case $1 in
        --priority=*)
            PRIORITY_FILTER="${1#*=}"
            shift
            ;;
        --status=*)
            STATUS_FILTER="${1#*=}"
            shift
            ;;
        --assignee=*)
            ASSIGNEE_FILTER="${1#*=}"
            shift
            ;;
        --search=*)
            SEARCH_FILTER="${1#*=}"
            shift
            ;;
        --tags=*)
            TAGS_FILTER="${1#*=}"
            shift
            ;;
        --since=*)
            SINCE_FILTER="${1#*=}"
            shift
            ;;
        --until=*)
            UNTIL_FILTER="${1#*=}"
            shift
            ;;
        --format=*)
            OUTPUT_FORMAT="${1#*=}"
            shift
            ;;
        --sort=*)
            SORT_FIELD="${1#*=}"
            shift
            ;;
        --group=*)
            GROUP_FIELD="${1#*=}"
            shift
            ;;
        --limit=*)
            LIMIT="${1#*=}"
            shift
            ;;
        --color)
            USE_COLOR="always"
            shift
            ;;
        --no-color)
            USE_COLOR="never"
            shift
            ;;
        --export=*)
            EXPORT_FILE="${1#*=}"
            shift
            ;;
        --template=*)
            TEMPLATE="${1#*=}"
            shift
            ;;
        --batch-close)
            BATCH_OPERATION="close"
            shift
            ;;
        --batch-assign=*)
            BATCH_OPERATION="assign"
            BATCH_VALUE="${1#*=}"
            shift
            ;;
        --batch-priority=*)
            BATCH_OPERATION="priority"
            BATCH_VALUE="${1#*=}"
            shift
            ;;
        --batch-status=*)
            BATCH_OPERATION="status"
            BATCH_VALUE="${1#*=}"
            shift
            ;;
        --force)
            FORCE_BATCH="true"
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

# Initialize batch operation variables
BATCH_OPERATION="${BATCH_OPERATION:-}"
BATCH_VALUE="${BATCH_VALUE:-}"
FORCE_BATCH="${FORCE_BATCH:-false}"

# Handle positional argument (quick filter)
if [ ${#ARGS[@]} -gt 0 ]; then
    QUICK_FILTER="${ARGS[0]}"
fi

# Apply quick filter mappings
case "$QUICK_FILTER" in
    all)
        STATUS_FILTER=""
        ;;
    open)
        STATUS_FILTER="open"
        ;;
    critical)
        PRIORITY_FILTER="critical"
        STATUS_FILTER="open"
        ;;
    high)
        PRIORITY_FILTER="high"
        STATUS_FILTER="open"
        ;;
    medium)
        PRIORITY_FILTER="medium"
        STATUS_FILTER="open"
        ;;
    low)
        PRIORITY_FILTER="low"
        STATUS_FILTER="open"
        ;;
    mine)
        ASSIGNEE_FILTER="me"
        STATUS_FILTER="open"
        ;;
esac

# Validate format
case "$OUTPUT_FORMAT" in
    table|json|markdown|csv)
        ;;
    *)
        echo "⚠️  Invalid format '$OUTPUT_FORMAT' - using table"
        OUTPUT_FORMAT="table"
        ;;
esac

# Set up color support
if [ "$USE_COLOR" = "auto" ]; then
    if [ -t 1 ] && command -v tput >/dev/null 2>&1 && [ "$(tput colors)" -ge 8 ]; then
        USE_COLOR="always"
    else
        USE_COLOR="never"
    fi
fi

# Color codes
if [ "$USE_COLOR" = "always" ]; then
    RED='\033[0;31m'
    YELLOW='\033[1;33m'
    GREEN='\033[0;32m'
    BLUE='\033[0;34m'
    PURPLE='\033[0;35m'
    CYAN='\033[0;36m'
    GRAY='\033[0;37m'
    BOLD='\033[1m'
    NC='\033[0m' # No Color
else
    RED=''
    YELLOW=''
    GREEN=''
    BLUE=''
    PURPLE=''
    CYAN=''
    GRAY=''
    BOLD=''
    NC=''
fi

echo "🔍 Filter Configuration:"
echo "• Quick filter: ${QUICK_FILTER:-'none'}"
echo "• Priority: ${PRIORITY_FILTER:-'all'}"
echo "• Status: ${STATUS_FILTER:-'all'}"
echo "• Assignee: ${ASSIGNEE_FILTER:-'all'}"
echo "• Format: $OUTPUT_FORMAT"
if [ -n "$SEARCH_FILTER" ]; then echo "• Search: $SEARCH_FILTER"; fi
if [ -n "$EXPORT_FILE" ]; then echo "• Export: $EXPORT_FILE"; fi
```

## 🎯 Step 2: Load Bug Data from Multiple Sources
```bash
echo "📂 Loading bug data..."

# Create temporary JSON file for combined data
COMBINED_DATA="/tmp/flowforge_bugs_$$.json"
TEMP_FILES+=("$COMBINED_DATA")

# Initialize combined data structure
echo '{"bugs": []}' > "$COMBINED_DATA"

BUGS_LOADED=0
SOURCES_LOADED=()

# Load from FlowForge backlog
if [ -f ".flowforge/bug-backlog.json" ]; then
    echo "📋 Loading from local bug backlog..."
    if command -v jq >/dev/null 2>&1; then
        if BACKLOG_BUGS=$(jq -r '.bugs[]' .flowforge/bug-backlog.json 2>/dev/null); then
            # Merge into combined data
            TEMP_MERGE="/tmp/flowforge_merge_$$.json"
            TEMP_FILES+=("$TEMP_MERGE")
            jq -s '.[0].bugs += .[1].bugs | .[0]' "$COMBINED_DATA" ".flowforge/bug-backlog.json" > "$TEMP_MERGE" 2>/dev/null && mv "$TEMP_MERGE" "$COMBINED_DATA"
            LOCAL_COUNT=$(jq '.bugs | length' "$COMBINED_DATA" 2>/dev/null || echo "0")
            echo "✅ Loaded $LOCAL_COUNT bugs from local backlog"
            BUGS_LOADED=$((BUGS_LOADED + LOCAL_COUNT))
            SOURCES_LOADED+=("local")
        fi
    else
        echo "⚠️  jq not available - cannot load JSON backlog"
    fi
fi

# Load from GitHub Issues using utility function
load_github_bugs "$COMBINED_DATA" "$STATUS_FILTER" "$ASSIGNEE_FILTER" "$SEARCH_FILTER" "$LIMIT" TEMP_FILES && SOURCES_LOADED+=("github")

# Remove duplicates using utility function
remove_duplicates "$COMBINED_DATA" TEMP_FILES

echo "📊 Data sources: ${SOURCES_LOADED[*]:-none}"
```

## 🎯 Step 3: Apply Filters and Search
```bash
echo "🔍 Applying filters and search..."

if command -v jq >/dev/null 2>&1 && [ -f "$COMBINED_DATA" ]; then
    # Apply filters using utility function
    apply_filters "$COMBINED_DATA" "$PRIORITY_FILTER" "$STATUS_FILTER" "$ASSIGNEE_FILTER" "$TAGS_FILTER" "$SEARCH_FILTER" "$SINCE_FILTER" "$UNTIL_FILTER" TEMP_FILES
    
    # Apply sorting using utility function
    apply_sorting "$COMBINED_DATA" "$SORT_FIELD" TEMP_FILES
    
    # Apply limit using utility function
    apply_limit "$COMBINED_DATA" "$LIMIT" TEMP_FILES
else
    echo "⚠️  Cannot apply filters - jq not available or no data"
fi
```

## 🎯 Step 4: Handle Batch Operations
```bash
# Process batch operations before output generation
if [ -n "$BATCH_OPERATION" ]; then
    echo "🔄 Processing batch operation: $BATCH_OPERATION"
    
    if [ ! -f "$COMBINED_DATA" ] || ! command -v jq >/dev/null 2>&1; then
        echo "❌ No data available or jq missing for batch operations"
        exit 1
    fi
    
    BATCH_COUNT=$(jq '.bugs | length' "$COMBINED_DATA" 2>/dev/null || echo "0")
    
    if [ "$BATCH_COUNT" = "0" ]; then
        echo "📭 No bugs match criteria for batch operation"
        exit 0
    fi
    
    # Show what will be affected
    echo "📋 Bugs affected by batch operation: $BATCH_COUNT"
    
    # List first few bugs that will be affected
    echo "Preview of affected bugs:"
    jq -r '.bugs[0:5] | .[] | "  #" + ((.github.number // .id) | tostring) + " - " + .title' "$COMBINED_DATA"
    if [ "$BATCH_COUNT" -gt 5 ]; then
        echo "  ... and $((BATCH_COUNT - 5)) more"
    fi
    echo ""
    
    # Confirmation prompt unless --force is used
    if [ "$FORCE_BATCH" != "true" ]; then
        case "$BATCH_OPERATION" in
            close)
                echo "⚠️  This will close $BATCH_COUNT bug(s)"
                ;;
            assign)
                echo "⚠️  This will assign $BATCH_COUNT bug(s) to $BATCH_VALUE"
                ;;
            priority)
                echo "⚠️  This will change priority of $BATCH_COUNT bug(s) to $BATCH_VALUE"
                ;;
            status)
                echo "⚠️  This will change status of $BATCH_COUNT bug(s) to $BATCH_VALUE"
                ;;
        esac
        
        echo -n "Are you sure you want to proceed? (y/N): "
        read -r CONFIRM
        if [[ ! "$CONFIRM" =~ ^[Yy]$ ]]; then
            echo "❌ Batch operation cancelled"
            exit 1
        fi
    fi
    
    # Execute batch operation
    BATCH_SUCCESS=0
    BATCH_FAILED=0
    
    case "$BATCH_OPERATION" in
        close)
            echo "🔨 Closing $BATCH_COUNT bugs..."
            # Process each bug
            jq -r '.bugs[] | @json' "$COMBINED_DATA" | while IFS= read -r bug_json; do
                BUG_ID=$(echo "$bug_json" | jq -r '.github.number // .id')
                BUG_SOURCE=$(echo "$bug_json" | jq -r '.source // "local"')
                
                if [ "$BUG_SOURCE" = "github" ]; then
                    github_batch_close "$BUG_ID" && BATCH_SUCCESS=$((BATCH_SUCCESS + 1)) || BATCH_FAILED=$((BATCH_FAILED + 1))
                else
                    update_local_bug "$BUG_ID" "close" "" TEMP_FILES && BATCH_SUCCESS=$((BATCH_SUCCESS + 1))
                fi
            done
            ;;
            
        assign)
            echo "🔨 Assigning $BATCH_COUNT bugs to $BATCH_VALUE..."
            jq -r '.bugs[] | @json' "$COMBINED_DATA" | while IFS= read -r bug_json; do
                BUG_ID=$(echo "$bug_json" | jq -r '.github.number // .id')
                BUG_SOURCE=$(echo "$bug_json" | jq -r '.source // "local"')
                
                if [ "$BUG_SOURCE" = "github" ]; then
                    github_batch_assign "$BUG_ID" "$BATCH_VALUE" && BATCH_SUCCESS=$((BATCH_SUCCESS + 1)) || BATCH_FAILED=$((BATCH_FAILED + 1))
                else
                    update_local_bug "$BUG_ID" "assign" "$BATCH_VALUE" TEMP_FILES && BATCH_SUCCESS=$((BATCH_SUCCESS + 1))
                fi
            done
            ;;
            
        priority)
            # Validate priority value
            if [[ ! "$BATCH_VALUE" =~ ^(critical|high|medium|low)$ ]]; then
                echo "❌ Invalid priority: $BATCH_VALUE (must be critical|high|medium|low)"
                exit 1
            fi
            
            echo "🔨 Changing priority of $BATCH_COUNT bugs to $BATCH_VALUE..."
            jq -r '.bugs[] | @json' "$COMBINED_DATA" | while IFS= read -r bug_json; do
                BUG_ID=$(echo "$bug_json" | jq -r '.github.number // .id')
                BUG_SOURCE=$(echo "$bug_json" | jq -r '.source // "local"')
                
                if [ "$BUG_SOURCE" = "github" ]; then
                    github_batch_priority "$BUG_ID" "$BATCH_VALUE" && BATCH_SUCCESS=$((BATCH_SUCCESS + 1)) || BATCH_FAILED=$((BATCH_FAILED + 1))
                else
                    update_local_bug "$BUG_ID" "priority" "$BATCH_VALUE" TEMP_FILES && BATCH_SUCCESS=$((BATCH_SUCCESS + 1))
                fi
            done
            ;;
            
        status)
            # Validate status value
            if [[ ! "$BATCH_VALUE" =~ ^(open|closed|in_progress)$ ]]; then
                echo "❌ Invalid status: $BATCH_VALUE (must be open|closed|in_progress)"
                exit 1
            fi
            
            echo "🔨 Changing status of $BATCH_COUNT bugs to $BATCH_VALUE..."
            jq -r '.bugs[] | @json' "$COMBINED_DATA" | while IFS= read -r bug_json; do
                BUG_ID=$(echo "$bug_json" | jq -r '.github.number // .id')
                BUG_SOURCE=$(echo "$bug_json" | jq -r '.source // "local"')
                
                if [ "$BUG_SOURCE" = "github" ]; then
                    github_batch_status "$BUG_ID" "$BATCH_VALUE" && BATCH_SUCCESS=$((BATCH_SUCCESS + 1)) || BATCH_FAILED=$((BATCH_FAILED + 1))
                else
                    update_local_bug "$BUG_ID" "status" "$BATCH_VALUE" TEMP_FILES && BATCH_SUCCESS=$((BATCH_SUCCESS + 1))
                fi
            done
            ;;
    esac
    
    # Display summary
    echo ""
    echo "════════════════════════════════════════════════════"
    echo "📊 BATCH OPERATION SUMMARY"
    echo "• Operation: $BATCH_OPERATION"
    if [ -n "$BATCH_VALUE" ]; then
        echo "• Value: $BATCH_VALUE"
    fi
    echo "• Total processed: $BATCH_COUNT"
    echo "• Successful: $BATCH_SUCCESS"
    echo "• Failed: $BATCH_FAILED"
    echo "════════════════════════════════════════════════════"
    
    # Clean up and exit after batch operation
    for temp_file in "${TEMP_FILES[@]}"; do
        [ -f "$temp_file" ] && rm -f "$temp_file"
    done
    
    exit 0
fi
```

## 🎯 Step 5: Generate Output Based on Format
```bash
echo "📊 Generating $OUTPUT_FORMAT output..."

if [ ! -f "$COMBINED_DATA" ] || ! command -v jq >/dev/null 2>&1; then
    echo "❌ No data available or jq missing"
    exit 1
fi

FINAL_BUG_COUNT=$(jq '.bugs | length' "$COMBINED_DATA" 2>/dev/null || echo "0")


if [ "$FINAL_BUG_COUNT" = "0" ]; then
    echo ""
    echo "📭 No bugs match your criteria"
    echo ""
    echo "💡 Try:"
    echo "• Broaden your filters: /flowforge:bug:list all"
    echo "• Check different status: --status=closed"
    echo "• Search for specific terms: --search=\"keyword\""
    echo "• List all bugs: /flowforge:bug:list --status=\"\""
    exit 0
fi

case "$OUTPUT_FORMAT" in
    json)
        export_json "$COMBINED_DATA" "$EXPORT_FILE" "$FINAL_BUG_COUNT"
        ;;
        
    csv)
        OUTPUT_FILE="${EXPORT_FILE:-/dev/stdout}"
        export_csv "$COMBINED_DATA" "$OUTPUT_FILE" "$FINAL_BUG_COUNT"
        ;;
        
    markdown)
        OUTPUT_FILE="${EXPORT_FILE:-/dev/stdout}"
        export_markdown "$COMBINED_DATA" "$OUTPUT_FILE" "$FINAL_BUG_COUNT" "$GROUP_FIELD"
        ;;
        
    table)
        echo ""
        echo "════════════════════════════════════════════════════"
        echo -e "${BOLD}🐛 BUG LIST - $FINAL_BUG_COUNT RESULTS${NC}"
        echo "════════════════════════════════════════════════════"
        
        # Use utility function for table display
        if [ "$GROUP_FIELD" = "priority" ]; then
            display_grouped_table "$COMBINED_DATA" "$USE_COLOR"
        else
            display_standard_table "$COMBINED_DATA" "$USE_COLOR"
        fi
        
        # Generate summary statistics using utility function
        generate_statistics "$COMBINED_DATA" "$USE_COLOR"
        ;;
esac

echo ""
```

## 🎯 Step 6: Additional Actions and Commands
```bash
if [ "$OUTPUT_FORMAT" = "table" ]; then
    echo "🔧 Available Actions:"
    echo "• Fix bug: /flowforge:bug:nobugbehind [id]"
    echo "• Add bug: /flowforge:bug:add"
    echo "• View details: gh issue view [id]"
    echo "• Close bug: gh issue close [id]"
    echo ""
    
    echo "📋 Useful Filters:"
    echo "• My bugs: /flowforge:bug:list --assignee=me"
    echo "• Critical only: /flowforge:bug:list critical"
    echo "• Recent bugs: /flowforge:bug:list --since=\"1 week ago\""
    echo "• Search: /flowforge:bug:list --search=\"keyword\""
    echo ""
    
    echo "🔄 Batch Operations:"
    echo "• Close all low priority: /flowforge:bug:list --priority=low --batch-close"
    echo "• Assign critical bugs: /flowforge:bug:list --priority=critical --batch-assign=username"
    echo "• Change old bugs priority: /flowforge:bug:list --since=\"30 days ago\" --batch-priority=low"
    echo "• Update status: /flowforge:bug:list --status=open --batch-status=in_progress"
    echo ""
    
    echo "📤 Export Options:"
    echo "• CSV export: /flowforge:bug:list --format=csv --export=bugs.csv"
    echo "• Markdown report: /flowforge:bug:list --format=markdown --export=report.md"
    echo "• JSON data: /flowforge:bug:list --format=json --export=bugs.json"
fi

# Clean up temp files
for temp_file in "${TEMP_FILES[@]}"; do
    [ -f "$temp_file" ] && rm -f "$temp_file"
done

# Initialize batch operation variables
BATCH_OPERATION="${BATCH_OPERATION:-}"
BATCH_VALUE="${BATCH_VALUE:-}"
FORCE_BATCH="${FORCE_BATCH:-false}"

exit 0
```

## 🎯 Success!

Advanced bug listing system provides:

**Rich Display Features:**
- Color-coded priority indicators (critical=red, high=yellow, medium=blue, low=green)
- Real-time GitHub integration for live status updates
- Multiple output formats (table, JSON, markdown, CSV)
- Grouping and sorting capabilities

**Powerful Filtering:**
- Priority, status, assignee, and date range filters
- Full-text search across titles and descriptions
- Tag-based filtering for categorization
- Quick filters for common use cases

**Export and Reporting:**
- Export to CSV, JSON, or Markdown formats
- Template-based reporting for different audiences
- Integration with external tools and systems

**Actionable Information:**
- Direct links to GitHub issues
- Suggested next actions for critical bugs
- Integration with bug fixing workflows
- Statistics and summary information

**Usage Examples:**
- `/flowforge:bug:list critical` - Show only critical bugs
- `/flowforge:bug:list --assignee=me --format=json` - My bugs in JSON
- `/flowforge:bug:list --search="login" --export=login-bugs.csv` - Export login-related bugs

This provides comprehensive bug visibility and management capabilities for efficient bug resolution workflows.