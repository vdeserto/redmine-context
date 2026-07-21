# Command: flowforge:session:start
# Version: 2.0.0
# Description: FlowForge session start command

---
description: Start a new work session with intelligent task detection and zero-friction setup
argument-hint: "[ticket-id] (optional - will auto-detect if not provided)"
---

# 🚀 Starting FlowForge Session

## 📋 Pre-flight Checks & Setup
```bash
set -euo pipefail  # Exit on error, undefined vars, pipe failures

# Error handler
handle_error() {
    local exit_code=$?
    local line_number=$1
    echo "❌ Error on line $line_number (exit code: $exit_code)"
    echo "💡 Debug with: DEBUG=1 /flowforge:session:start"
    
    # Clean up any partial work
    if [ -n "${TEMP_FILE:-}" ] && [ -f "$TEMP_FILE" ]; then
        rm -f "$TEMP_FILE"
    fi
    
    exit $exit_code
}
trap 'handle_error $LINENO' ERR

# Debug mode
[[ "${DEBUG:-0}" == "1" ]] && set -x

# Check for help request
if [[ "${ARGUMENTS:-}" == "?" || "${ARGUMENTS:-}" == "help" ]]; then
    cat << 'HELP'
🚀 FlowForge Session Start

Usage: /flowforge:session:start [ticket-id]

What it does:
✓ Auto-detects current task from any provider
✓ Sets up proper Git branch
✓ Starts time tracking
✓ Runs pre-flight checks
✓ Displays helpful context

Auto-detection order:
1. Current session data (.flowforge/local/session.json)
2. Next ticket from provider task order
3. In-progress tickets from provider system
4. Position tracking (if available)
5. Provider assigned tickets (GitHub, Linear, Jira, Local, etc.)

Examples:
  /flowforge:session:start          # Auto-detect ticket
  /flowforge:session:start 123      # Start work on ticket #123
  /flowforge:session:start LIN-456  # Start work on Linear ticket LIN-456
  /flowforge:session:start task-789 # Start work on Local ticket 789
  /flowforge:session:start ?        # Show this help

Options:
  [ticket-id]     Optional ticket ID (GitHub, Linear, Jira, Local, etc.)
  ?/help          Show this help
  DEBUG=1         Enable debug output

After running:
- Time tracking is active
- You're on the correct Git branch
- You're ready to start coding!
HELP
    exit 0
fi

echo "🚀 Starting FlowForge Session..."

# First check if we're in a git repository
if ! git rev-parse --git-dir > /dev/null 2>&1; then
    echo "❌ Not in a git repository!"
    echo "💡 Initialize with: git init"
    exit 1
fi

# Ensure directories exist
mkdir -p .flowforge/sessions .flowforge/logs documentation/development
```

## 🎯 Step 1: Intelligent Task Detection
```bash
# Initialize variables
TICKET_ID="${ARGUMENTS:-}"  # Universal ticket ID
DETECTED_TICKET=""
DETECTION_SOURCE=""

# Check if provider bridge is available
PROVIDER_BRIDGE=""
if [ -f "./scripts/provider-bridge.js" ]; then
    PROVIDER_BRIDGE="./scripts/provider-bridge.js"
elif [ -f "./dist/scripts/provider-bridge.js" ]; then
    PROVIDER_BRIDGE="./dist/scripts/provider-bridge.js"
fi

# If no ticket provided, detect from various sources
if [ -z "$TICKET_ID" ]; then
    echo "🔍 No ticket specified - detecting current ticket..."
    
    # Check current session first
    if [ -f ".flowforge/local/session.json" ] && command -v jq &> /dev/null; then
        # CRITICAL: Validate JSON format before reading to prevent corruption
        if jq empty .flowforge/local/session.json 2>/dev/null; then
            DETECTED_TICKET=$(jq -r '.taskId // empty' .flowforge/local/session.json 2>/dev/null || true)
        else
            echo "⚠️  current.json is corrupted (invalid JSON) - recreating..."
            rm -f .flowforge/local/session.json
            echo '{}' > .flowforge/local/session.json
            DETECTED_TICKET=""
        fi
        if [ -n "$DETECTED_TICKET" ]; then
            # CRITICAL: Validate detected ticket is not corrupted
            if [ -f "./scripts/validate-task-id.sh" ] && ! ./scripts/validate-task-id.sh "$DETECTED_TICKET" 2>/dev/null; then
                echo "⚠️  Current session has corrupted task ID: $DETECTED_TICKET (clearing)"
                echo '{}' > .flowforge/local/session.json
                DETECTED_TICKET=""
            fi
        fi
        if [ -n "$DETECTED_TICKET" ]; then
            # CRITICAL: Verify this ticket is still valid via provider system
            if [ -n "$PROVIDER_BRIDGE" ] && command -v node &> /dev/null; then
                if TICKET_STATUS=$(timeout 5 node "$PROVIDER_BRIDGE" verify-ticket --id="$DETECTED_TICKET" --format=simple 2>/dev/null); then
                    if [[ "$TICKET_STATUS" =~ ^(CLOSED|DONE|COMPLETED|closed|done|completed)$ ]]; then
                        echo "⚠️  Previous ticket #$DETECTED_TICKET is $TICKET_STATUS, looking for new ticket..."
                        DETECTED_TICKET=""
                    else
                        DETECTION_SOURCE="Current session (provider verified)"
                        echo "✅ Found ticket #$DETECTED_TICKET from current session (status: $TICKET_STATUS)"
                    fi
                else
                    # Fallback to GitHub if provider fails and ticket is numeric
                    if command -v gh &> /dev/null && [[ "$DETECTED_TICKET" =~ ^[0-9]+$ ]]; then
                        GH_STATE=$(timeout 5 gh issue view "$DETECTED_TICKET" --json state -q '.state' 2>/dev/null || echo "unknown")
                        if [ "$GH_STATE" = "CLOSED" ]; then
                            echo "⚠️  Previous ticket #$DETECTED_TICKET is CLOSED, looking for new ticket..."
                            DETECTED_TICKET=""
                        else
                            DETECTION_SOURCE="Current session (GitHub fallback)"
                            echo "✅ Found ticket #$DETECTED_TICKET from current session (GitHub: $GH_STATE)"
                        fi
                    else
                        DETECTION_SOURCE="Current session"
                        echo "✅ Found ticket #$DETECTED_TICKET from current session"
                    fi
                fi
            else
                DETECTION_SOURCE="Current session"
                echo "✅ Found ticket #$DETECTED_TICKET from current session"
            fi
        fi
    fi
    
    # PRIORITY: Check provider system for assigned tickets FIRST
    if [ -z "$DETECTED_TICKET" ] && [ -n "$PROVIDER_BRIDGE" ] && command -v node &> /dev/null; then
        echo "📋 Checking provider system for assigned tickets (priority)..."
        if DETECTED_TICKET=$(timeout 5 node "$PROVIDER_BRIDGE" list-tasks --assigned=me --status=open --limit=1 --format=simple 2>/dev/null); then
            if [ -n "$DETECTED_TICKET" ] && [ "$DETECTED_TICKET" != "NONE" ]; then
                DETECTION_SOURCE="Provider system (assigned to you)"
                echo "✅ Found assigned ticket #$DETECTED_TICKET from provider"
            fi
        else
            echo "⚠️  Could not query provider system for assigned tickets"
        fi
    fi

    # FALLBACK: Check GitHub for assigned issues if provider didn't find anything
    if [ -z "$DETECTED_TICKET" ] && command -v gh &> /dev/null; then
        echo "📋 Checking GitHub for assigned tickets (fallback)..."
        if DETECTED_TICKET=$(timeout 5 gh issue list --assignee @me --state open --limit 1 --json number -q '.[0].number' 2>/dev/null); then
            if [ -n "$DETECTED_TICKET" ]; then
                DETECTION_SOURCE="GitHub (assigned to you - verified open)"
                echo "✅ Found assigned ticket #$DETECTED_TICKET on GitHub"
            fi
        else
            echo "⚠️  Could not query GitHub (check GITHUB_TOKEN)"
        fi
    fi
    
    # Then check provider system for next available ticket
    if [ -z "$DETECTED_TICKET" ] && [ -n "$PROVIDER_BRIDGE" ] && command -v node &> /dev/null; then
        echo "📋 Checking provider system for next ticket..."
        # Use get-next-task for intelligent ticket selection
        NEXT_TASK=$(timeout 5 node "$PROVIDER_BRIDGE" get-next-task --format=simple 2>/dev/null || echo "NONE")
        
        if [ "$NEXT_TASK" != "NONE" ] && [ -n "$NEXT_TASK" ]; then
            # CRITICAL: Verify this ticket isn't closed via provider system
            if TICKET_STATUS=$(timeout 5 node "$PROVIDER_BRIDGE" verify-ticket --id="$NEXT_TASK" --format=simple 2>/dev/null); then
                if [[ "$TICKET_STATUS" =~ ^(CLOSED|DONE|COMPLETED|closed|done|completed)$ ]]; then
                    echo "⚠️  Ticket #$NEXT_TASK is $TICKET_STATUS, skipping..."
                    # Update provider system to mark it as completed
                    timeout 5 node "$PROVIDER_BRIDGE" update-task --id="$NEXT_TASK" --status=completed --description="Ticket marked as closed" 2>/dev/null || true
                else
                    DETECTED_TICKET="$NEXT_TASK"
                    DETECTION_SOURCE="Provider system (status: $TICKET_STATUS)"
                    echo "✅ Found next ticket #$DETECTED_TICKET from provider"
                fi
            else
                # Fallback to GitHub verification if provider fails and ticket is numeric
                if command -v gh &> /dev/null && [[ "$NEXT_TASK" =~ ^[0-9]+$ ]]; then
                    GH_STATE=$(timeout 5 gh issue view "$NEXT_TASK" --json state -q '.state' 2>/dev/null || echo "unknown")
                    if [ "$GH_STATE" = "CLOSED" ]; then
                        echo "⚠️  Ticket #$NEXT_TASK is CLOSED on GitHub, skipping..."
                        timeout 5 node "$PROVIDER_BRIDGE" update-task --id="$NEXT_TASK" --status=completed --description="GitHub issue closed" 2>/dev/null || true
                    else
                        DETECTED_TICKET="$NEXT_TASK"
                        DETECTION_SOURCE="Provider system (GitHub fallback: $GH_STATE)"
                        echo "✅ Found next ticket #$DETECTED_TICKET from provider"
                    fi
                else
                    DETECTED_TICKET="$NEXT_TASK"
                    DETECTION_SOURCE="Provider system"
                    echo "✅ Found next ticket #$DETECTED_TICKET from provider"
                fi
            fi
        else
            # Fallback to checking for in-progress tickets
            echo "📋 Checking for in-progress tickets in provider system..."
            DETECTED_TICKET=$(timeout 5 node "$PROVIDER_BRIDGE" list-tasks --status=in_progress --format=simple 2>/dev/null | head -1 || true)
            if [ -z "$DETECTED_TICKET" ]; then
                # Get first ready/pending ticket if no in-progress
                DETECTED_TICKET=$(timeout 5 node "$PROVIDER_BRIDGE" list-tasks --status=ready --format=simple 2>/dev/null | head -1 || true)
            fi
            if [ -n "$DETECTED_TICKET" ]; then
                # Verify with provider system first
                if TICKET_STATUS=$(timeout 5 node "$PROVIDER_BRIDGE" verify-ticket --id="$DETECTED_TICKET" --format=simple 2>/dev/null); then
                    if [[ "$TICKET_STATUS" =~ ^(CLOSED|DONE|COMPLETED|closed|done|completed)$ ]]; then
                        echo "⚠️  Ticket #$DETECTED_TICKET is $TICKET_STATUS, skipping..."
                        timeout 5 node "$PROVIDER_BRIDGE" update-task --id="$DETECTED_TICKET" --status=completed 2>/dev/null || true
                        DETECTED_TICKET=""
                    else
                        DETECTION_SOURCE="Provider system (status: $TICKET_STATUS)"
                        echo "✅ Found ticket #$DETECTED_TICKET from provider"
                    fi
                else
                    # Fallback to GitHub verification for numeric IDs
                    if command -v gh &> /dev/null && [[ "$DETECTED_TICKET" =~ ^[0-9]+$ ]]; then
                        GH_STATE=$(timeout 5 gh issue view "$DETECTED_TICKET" --json state -q '.state' 2>/dev/null || echo "unknown")
                        if [ "$GH_STATE" = "CLOSED" ]; then
                            echo "⚠️  Ticket #$DETECTED_TICKET is CLOSED on GitHub, skipping..."
                            timeout 5 node "$PROVIDER_BRIDGE" update-task --id="$DETECTED_TICKET" --status=completed 2>/dev/null || true
                            DETECTED_TICKET=""
                        else
                            DETECTION_SOURCE="Provider system (GitHub fallback: $GH_STATE)"
                            echo "✅ Found ticket #$DETECTED_TICKET from provider"
                        fi
                    else
                        DETECTION_SOURCE="Provider system"
                        echo "✅ Found ticket #$DETECTED_TICKET from provider"
                    fi
                fi
            fi
        fi
    fi
    
    # Use detected ticket if found
    if [ -n "$DETECTED_TICKET" ]; then
        TICKET_ID="$DETECTED_TICKET"
        echo "🎯 Using detected ticket #$TICKET_ID ($DETECTION_SOURCE)"
    fi
else
    echo "🎯 Starting session for ticket #$TICKET_ID"
fi

# If no ticket found at all, exit with helpful message
if [ -z "$TICKET_ID" ]; then
    echo "❌ No ticket specified and could not auto-detect one"
    echo "💡 Options:"
    echo "1. Specify a ticket: /flowforge:session:start 123"
    if [ -n "$PROVIDER_BRIDGE" ]; then
        echo "2. List tickets: node \$PROVIDER_BRIDGE list-tasks --status=open"
        echo "3. Create ticket: node \$PROVIDER_BRIDGE create-task --title='New Task'"
    fi
    if command -v gh &> /dev/null; then
        echo "4. List GitHub issues: gh issue list --state open"
        echo "5. Create GitHub issue: gh issue create --title 'New Task'"
    fi
    echo "6. Run /plan to properly plan new work"
    exit 1
fi

# Validate ticket ID format and legitimacy
if ! [[ "$TICKET_ID" =~ ^[a-zA-Z0-9._/-]+$ ]]; then
    echo "❌ Invalid ticket ID: $TICKET_ID"
    echo "💡 Ticket IDs should be valid format (e.g., 123, LIN-456, task-789)"
    exit 1
fi

# CRITICAL: Validate that this is a legitimate ticket ID
echo "🔍 Validating ticket ID legitimacy..."
if [ -f "./scripts/validate-task-id.sh" ]; then
    # Enhanced validation supports all ticket formats
    if ! ./scripts/validate-task-id.sh "$TICKET_ID"; then
        echo "❌ Session start blocked: Ticket ID validation failed"
        echo "💡 Use a valid ticket ID (not a PR number if GitHub)"
        if [ -n "$PROVIDER_BRIDGE" ]; then
            echo "💡 List valid tickets: node \$PROVIDER_BRIDGE list-tasks --status=open"
        fi
        if command -v gh &> /dev/null; then
            echo "💡 List GitHub issues: gh issue list --state open"
        fi
        exit 1
    fi
else
    echo "⚠️  Ticket ID validation script not found - continuing with basic validation"
fi
```

## 🎯 Step 2: Load Essential FlowForge Rules
```bash
# Load essential FlowForge rules for session context
echo -e "\n🎯 Loading Essential FlowForge Rules..."

# Set work type for context-aware rules
export WORK_TYPE=""
export TICKET_TITLE="${TICKET_TITLE:-}"

# Detect work type from issue title for context-aware rules
if [ -n "$TICKET_TITLE" ]; then
    case "${TICKET_TITLE,,}" in
        *database*|*db*|*migration*) export WORK_TYPE="database" ;;
        *doc*|*readme*|*guide*) export WORK_TYPE="documentation" ;;
        *test*|*spec*|*coverage*) export WORK_TYPE="testing" ;;
        *bug*|*fix*|*error*) export WORK_TYPE="bug" ;;
        *api*|*endpoint*) export WORK_TYPE="api" ;;
        *) export WORK_TYPE="general" ;;
    esac
fi

# Load rules using the essential rules loader
if [ -f "scripts/essential-rules-loader.sh" ]; then
    source scripts/essential-rules-loader.sh

    # Load essential rules (target: < 100ms)
    if load_essential_rules; then
        echo "✅ Essential FlowForge rules loaded successfully"

        # Ensure rules context is available for agents
        if [ ! -f ".flowforge/local/essential-rules.json" ]; then
            echo "⚠️  Rules context file not created"
        fi
    else
        echo "⚠️  Rules loading encountered issues, using fallback rules"
    fi
else
    echo "⚠️  Essential rules loader not found"
    echo "💡 Creating minimal rules context..."

    # Create minimal fallback rules context
    mkdir -p .flowforge/local
    cat > .flowforge/local/essential-rules.json << 'EOF'
{
    "core_rules": [
        {
            "number": 3,
            "title": "TDD - MANDATORY",
            "summary": "Write tests BEFORE code. 80%+ coverage required."
        },
        {
            "number": 36,
            "title": "Time Tracking is Money",
            "summary": "Timer MUST be running for all work."
        },
        {
            "number": 35,
            "title": "Use FlowForge Agents",
            "summary": "MANDATORY: Use agents when available."
        }
    ],
    "context_rules": [],
    "loaded_at": "FALLBACK",
    "work_type": "unknown"
}
EOF
    echo "✅ Minimal rules context created"
fi

# Create agent context with rules for future spawning
echo -e "\n🤖 Preparing agent context with rules..."
AGENT_CONTEXT_FILE=".flowforge/local/agent-context.json"

if [ -f ".flowforge/local/essential-rules.json" ]; then
    rules_json=$(cat .flowforge/local/essential-rules.json)

    cat > "$AGENT_CONTEXT_FILE" << EOF
{
    "session": {
        "ticket": "$TICKET_ID",
        "branch": "TBD",
        "work_type": "${WORK_TYPE:-general}",
        "started_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    },
    "rules": $rules_json,
    "emphasis": {
        "tdd_first": "ALWAYS write tests before code - Rule #3",
        "time_tracking": "Timer must be running - Rule #36",
        "use_agents": "Use FlowForge agents when available - Rule #35"
    },
    "context_files": {
        "rules": ".flowforge/local/essential-rules.json",
        "session": ".flowforge/local/session.json",
        "tdd_context": ".flowforge/local/tdd-context.json"
    }
}
EOF
    echo "✅ Agent context prepared with FlowForge rules"
else
    echo "⚠️  Could not prepare agent context with rules"
fi
```

## 📋 Step 3: Universal Ticket Validation
```bash
# Universal ticket validation function
validate_universal_ticket() {
    local ticket_id="$1"
    local provider=""
    local ticket_exists=false
    local provider_name="unknown"

    echo -e "\n📋 Verifying ticket #$ticket_id..."

    # Try provider bridge first for universal validation
    if [ -n "$PROVIDER_BRIDGE" ] && command -v node &> /dev/null; then
        echo "🔍 Checking via provider system..."

        # Get active provider info
        if PROVIDER_INFO=$(timeout 5 node "$PROVIDER_BRIDGE" get-provider --format=json 2>/dev/null); then
            if command -v jq &> /dev/null; then
                provider_name=$(echo "$PROVIDER_INFO" | jq -r '.name // "unknown"')
                local provider_type=$(echo "$PROVIDER_INFO" | jq -r '.type // "unknown"')
                echo "📌 Active provider: $provider_name ($provider_type)"
            else
                provider_name="Provider System"
            fi
        fi

        # Validate ticket exists across all providers with enhanced error handling
        if TICKET_INFO=$(timeout 10 node "$PROVIDER_BRIDGE" verify-ticket --id="$ticket_id" --format=json 2>/dev/null); then
            ticket_exists=true

            if command -v jq &> /dev/null && [ -n "$TICKET_INFO" ]; then
                TICKET_TITLE=$(echo "$TICKET_INFO" | jq -r '.title // "Unknown"' 2>/dev/null || echo "Unknown")
                TICKET_STATUS=$(echo "$TICKET_INFO" | jq -r '.status // "unknown"' 2>/dev/null || echo "unknown")
                local ticket_state=$(echo "$TICKET_INFO" | jq -r '.state // .status // "unknown"' 2>/dev/null || echo "unknown")
                local ticket_url=$(echo "$TICKET_INFO" | jq -r '.url // ""' 2>/dev/null || echo "")

                # Check if ticket is closed/completed with better state detection
                if [[ "$ticket_state" =~ ^(CLOSED|DONE|COMPLETED|FINISHED|RESOLVED|closed|done|completed|finished|resolved)$ ]]; then
                    echo "⚠️  Ticket #$ticket_id is ${ticket_state^^} in $provider_name"
                    echo "💡 Find an open ticket:"
                    echo "   • Provider: node $PROVIDER_BRIDGE list-tasks --status=open --format=text"
                    if command -v gh &> /dev/null; then
                        echo "   • GitHub: gh issue list --state open"
                    fi
                    exit 1
                else
                    echo "✅ Ticket #$ticket_id verified in $provider_name"
                    echo "📋 Title: $TICKET_TITLE"
                    echo "🎯 Status: $TICKET_STATUS"
                    [ -n "$ticket_url" ] && echo "🔗 URL: $ticket_url"

                    # Display ticket details with improved formatting
                    echo "════════════════════════════════════════"
                    if timeout 10 node "$PROVIDER_BRIDGE" get-task --id="$ticket_id" --format=markdown 2>/dev/null; then
                        :  # Success
                    else
                        echo "📝 Ticket #$ticket_id: $TICKET_TITLE"
                        echo "Status: $TICKET_STATUS"
                        echo "⚠️  Could not load full ticket details"
                    fi
                    echo "════════════════════════════════════════"
                fi
            else
                echo "✅ Ticket #$ticket_id verified in $provider_name"
                TICKET_TITLE="Ticket #$ticket_id"
                TICKET_STATUS="verified"
            fi
        else
            # Ticket not found in provider system - get more details
            echo "⚠️  Ticket #$ticket_id not found in $provider_name"

            # Try to get available ticket formats from provider
            if timeout 5 node "$PROVIDER_BRIDGE" get-provider --format=json 2>/dev/null | jq -e '.supportedFormats' >/dev/null 2>&1; then
                local supported_formats=$(timeout 5 node "$PROVIDER_BRIDGE" get-provider --format=json 2>/dev/null | jq -r '.supportedFormats[]?' 2>/dev/null | tr '\n' ', ' | sed 's/,$//')
                [ -n "$supported_formats" ] && echo "💡 Supported formats: $supported_formats"
            fi

            ticket_exists=false
        fi
    fi

    # Enhanced GitHub fallback with better error handling
    if [ "$ticket_exists" = false ] && command -v gh &> /dev/null; then
        echo "🔍 Checking GitHub as fallback..."

        # Enhanced ticket format detection
        if [[ "$ticket_id" =~ ^[0-9]+$ ]]; then
            echo "📌 Checking GitHub issue #$ticket_id..."

            if GH_OUTPUT=$(timeout 10 gh issue view "$ticket_id" --json state,title,url -q '{state: .state, title: .title, url: .url}' 2>&1); then
                if command -v jq &> /dev/null && echo "$GH_OUTPUT" | jq empty 2>/dev/null; then
                    local gh_state=$(echo "$GH_OUTPUT" | jq -r '.state // "NOT_FOUND"')
                    local gh_title=$(echo "$GH_OUTPUT" | jq -r '.title // "Unknown"')
                    local gh_url=$(echo "$GH_OUTPUT" | jq -r '.url // ""')

                    if [ "$gh_state" = "CLOSED" ]; then
                        echo "⚠️  GitHub ticket #$ticket_id is CLOSED"
                        echo "💡 Find an open issue: gh issue list --state open --limit 10"
                        exit 1
                    elif [ "$gh_state" = "OPEN" ]; then
                        echo "✅ Ticket #$ticket_id verified via GitHub"
                        echo "📋 Title: $gh_title"
                        echo "🎯 Status: open"
                        [ -n "$gh_url" ] && echo "🔗 URL: $gh_url"

                        TICKET_TITLE="$gh_title"
                        TICKET_STATUS="open"
                        ticket_exists=true
                        provider_name="GitHub"

                        # Display GitHub issue details with better formatting
                        echo "════════════════════════════════════════"
                        if gh issue view "$ticket_id" --comments=false 2>/dev/null; then
                            :  # Success
                        else
                            echo "📝 GitHub ticket #$ticket_id: $gh_title"
                            echo "Status: open"
                        fi
                        echo "════════════════════════════════════════"
                    fi
                fi
            else
                # Parse GitHub CLI error messages for better feedback
                if echo "$GH_OUTPUT" | grep -q "Could not resolve to an Issue"; then
                    echo "⚠️  Ticket #$ticket_id not found in GitHub"
                    # Check if it might be a PR instead
                    if timeout 5 gh pr view "$ticket_id" --json state 2>/dev/null | jq -e '.state' >/dev/null 2>&1; then
                        echo "💡 Found PR #$ticket_id instead - use the corresponding issue number"
                    fi
                elif echo "$GH_OUTPUT" | grep -q "authentication"; then
                    echo "⚠️  GitHub authentication failed - check GITHUB_TOKEN"
                else
                    echo "⚠️  GitHub query failed: $(echo "$GH_OUTPUT" | head -1)"
                fi
            fi
        elif [[ "$ticket_id" =~ ^[A-Z]+-[0-9]+$ ]]; then
            echo "💡 Ticket format '$ticket_id' appears to be from external system (Linear/Jira)"
            echo "   GitHub fallback not applicable for this format"
        else
            echo "💡 Ticket format '$ticket_id' - checking compatibility..."
            echo "   GitHub supports numeric IDs only (e.g., 123, 456)"
        fi
    fi

    # Enhanced final validation with provider-specific guidance
    if [ "$ticket_exists" = false ]; then
        echo "❌ Ticket #$ticket_id not found in any configured provider!"
        echo ""
        echo "💡 Available options:"

        if [ -n "$PROVIDER_BRIDGE" ]; then
            echo "1. List open tickets: node $PROVIDER_BRIDGE list-tasks --status=open --format=text"
            echo "2. Create new ticket: node $PROVIDER_BRIDGE create-task --title='New Work Item'"

            # Show provider-specific help if available
            if timeout 5 node "$PROVIDER_BRIDGE" get-provider --format=json 2>/dev/null | jq -e '.helpCommands' >/dev/null 2>&1; then
                echo "3. Provider help: node $PROVIDER_BRIDGE help"
            fi
        fi

        if command -v gh &> /dev/null; then
            echo "4. List GitHub issues: gh issue list --state open --limit 10"
            echo "5. Create GitHub issue: gh issue create --title 'New Work Item'"
        fi

        echo "6. Plan new work: /flowforge:project:plan \"New Feature\""
        echo ""
        echo "🔍 Troubleshooting:"
        echo "   • Verify ticket ID format matches provider expectations"
        echo "   • Check if ticket exists but is in wrong state (closed/completed)"
        echo "   • Ensure provider authentication is configured"
        exit 1
    fi

    # Ensure variables are always set for session data with fallbacks
    TICKET_TITLE="${TICKET_TITLE:-Ticket #$ticket_id}"
    TICKET_STATUS="${TICKET_STATUS:-verified}"

    # Set global provider context for session
    export ACTIVE_PROVIDER="$provider_name"

    echo "✅ Universal ticket validation completed successfully"
    echo "📊 Provider: $provider_name | Status: $TICKET_STATUS"
    return 0
}

# Run universal ticket validation
TICKET_VERIFIED=false
TICKET_STATE="UNKNOWN"
TICKET_TITLE=""
TICKET_STATUS=""

validate_universal_ticket "$TICKET_ID"
TICKET_VERIFIED=true
```

## 🏗️ Step 3.5: Auto-Create Developer Namespace (Zero-Friction)
```bash
# Automatically create developer namespace - no manual setup required!
echo -e "\n🏗️ Setting up developer workspace..."

# Get developer identity (multiple fallback methods)
get_developer_identity() {
    # Priority order for identity detection
    if [ -n "${FLOWFORGE_DEV_ID:-}" ]; then
        echo "${FLOWFORGE_DEV_ID}"
    elif [ -n "${USER:-}" ]; then
        echo "${USER}"
    elif command -v whoami &> /dev/null; then
        whoami
    elif [ -n "${USERNAME:-}" ]; then
        echo "${USERNAME}"
    else
        # Fallback to git config
        git config user.name 2>/dev/null | tr ' ' '-' | tr '[:upper:]' '[:lower:]' || echo "developer"
    fi
}

# Create namespace with all required subdirectories
ensure_developer_namespace() {
    local dev_id=$(get_developer_identity)
    local namespace_dir=".flowforge/dev-${dev_id}"

    # Check if namespace already exists (skip if it does for performance)
    if [[ -d "${namespace_dir}" ]] && [[ -f "${namespace_dir}/.initialized" ]]; then
        echo "✅ Developer workspace ready: dev-${dev_id}"
        export FLOWFORGE_NAMESPACE="${namespace_dir}"
        export FLOWFORGE_DEV_ID="${dev_id}"
        return 0
    fi

    echo "🔧 Initializing workspace for: ${dev_id}"

    # Create all required directories in one go
    mkdir -p "${namespace_dir}"/{sessions,config,cache,logs,workspace} 2>/dev/null || {
        echo "⚠️  Could not create full namespace structure, trying basic setup..."
        mkdir -p "${namespace_dir}" 2>/dev/null || true
    }

    # Initialize developer configuration if it doesn't exist
    if [[ ! -f "${namespace_dir}/config/developer.json" ]]; then
        cat > "${namespace_dir}/config/developer.json" 2>/dev/null <<EOF
{
    "developer": "${dev_id}",
    "created": "$(date -Iseconds)",
    "flowforge_version": "$(cat .flowforge/VERSION 2>/dev/null || echo '2.0.0')",
    "preferences": {
        "auto_commit": false,
        "verbose_logging": false,
        "namespace_version": "1.0"
    }
}
EOF
    fi

    # Create initialization marker
    touch "${namespace_dir}/.initialized" 2>/dev/null

    # Set environment variables for session
    export FLOWFORGE_NAMESPACE="${namespace_dir}"
    export FLOWFORGE_DEV_ID="${dev_id}"

    # Create README for developer
    if [[ ! -f "${namespace_dir}/README.md" ]]; then
        cat > "${namespace_dir}/README.md" 2>/dev/null <<EOF
# Developer Namespace: ${dev_id}

This is your personal FlowForge workspace. All files in this directory are:
- Automatically ignored by git
- Private to your development environment
- Not shared with other developers

## Directory Structure
- \`sessions/\` - Your session data and state
- \`config/\` - Your personal configurations
- \`cache/\` - Your local cache files
- \`logs/\` - Your development logs
- \`workspace/\` - Your temporary work files

## Usage
You don't need to do anything! FlowForge automatically manages this space.

Created: $(date)
EOF
    fi

    echo "✅ Developer workspace initialized: ${namespace_dir}"
    echo "📝 Your files are in: ${namespace_dir}/"
}

# Run namespace creation (this is automatic, zero-friction!)
ensure_developer_namespace || {
    # Fallback if namespace creation fails - just warn and continue
    echo "⚠️  Could not create full developer namespace (continuing anyway)"
    # Ensure at least basic directory exists
    mkdir -p ".flowforge/dev-$(get_developer_identity)" 2>/dev/null || true
}

# Load namespace integration for Git sync functionality
if [ -f "./scripts/namespace/integrate.sh" ]; then
    echo "🔄 Loading namespace integration..."
    source "./scripts/namespace/integrate.sh"

    # Initialize namespace with Git integration
    if type -t integrate_session_start &>/dev/null; then
        integrate_session_start "$TICKET_ID" || {
            echo "⚠️  Namespace integration failed (continuing anyway)"
        }
    fi
else
    echo "⚠️  Namespace integration not available (continuing without sync)"
fi
```

## 🌿 Step 4: Setup Git Branch
```bash
# Ensure we're on the correct branch
echo -e "\n🌿 Setting up Git branch..."

# Get current branch with error handling
CURRENT_BRANCH=""
if ! CURRENT_BRANCH=$(git branch --show-current 2>&1); then
    echo "❌ Not in a git repository!"
    echo "💡 Initialize with: git init"
    exit 1
fi

# Determine expected branch name based on milestone mode
if [[ -f ".milestone-context" ]]; then
    # Trim whitespace and validate
    MILESTONE_NAME=$(cat .milestone-context 2>/dev/null | xargs || echo "")

    # Validate milestone name (git-safe characters only)
    # Allow alphanumeric, dots, underscores, hyphens, and forward slashes
    # Limit to 100 characters for branch name safety
    if [[ -n "$MILESTONE_NAME" ]] && [[ "$MILESTONE_NAME" =~ ^[a-zA-Z0-9._/-]+$ ]] && [[ ${#MILESTONE_NAME} -le 100 ]]; then
        EXPECTED_BRANCH="milestone/${MILESTONE_NAME}/ticket/${TICKET_ID}"
        echo "🎯 Milestone mode active: $MILESTONE_NAME"
    else
        EXPECTED_BRANCH="feature/${TICKET_ID}-work"
        if [[ -n "$MILESTONE_NAME" ]]; then
            echo "⚠️  Invalid milestone name format (must be alphanumeric with ._/- only), using normal mode"
        fi
    fi
else
    EXPECTED_BRANCH="feature/${TICKET_ID}-work"
fi

# Check if we need to create/switch branches
if [[ "$CURRENT_BRANCH" == "main" ]] || [[ "$CURRENT_BRANCH" == "develop" ]]; then
    echo "📍 Currently on protected branch: $CURRENT_BRANCH"
    
    # Pull latest changes
    echo "🔄 Pulling latest changes..."
    if ! git pull origin "$CURRENT_BRANCH" 2>&1; then
        echo "⚠️  Could not pull latest changes (continuing anyway)"
    fi
    
    # Create feature branch
    if git show-ref --verify --quiet "refs/heads/$EXPECTED_BRANCH"; then
        echo "🔀 Switching to existing branch: $EXPECTED_BRANCH"
        git checkout "$EXPECTED_BRANCH"
        git pull origin "$EXPECTED_BRANCH" 2>/dev/null || true
    else
        echo "🌱 Creating new feature branch: $EXPECTED_BRANCH"
        if ! git checkout -b "$EXPECTED_BRANCH"; then
            echo "❌ Failed to create branch!"
            echo "💡 Check for uncommitted changes: git status"
            exit 1
        fi
        echo "✅ Branch created and checked out"
    fi
elif [[ "$CURRENT_BRANCH" == *"$TICKET_ID"* ]]; then
    echo "✅ Already on correct branch: $CURRENT_BRANCH"
    # Pull latest if remote exists
    git pull origin "$CURRENT_BRANCH" 2>/dev/null || true
else
    echo "⚠️  On branch: $CURRENT_BRANCH"
    echo "💡 Consider creating a feature branch for ticket #$TICKET_ID"
    
    # Check if we're in interactive mode
    if [ -t 0 ]; then
        echo -n "Create $EXPECTED_BRANCH branch? [Y/n] "
        read -r REPLY
        if [[ $REPLY =~ ^[Yy]$ ]] || [[ -z $REPLY ]]; then
            if git checkout -b "$EXPECTED_BRANCH"; then
                echo "✅ Created and switched to $EXPECTED_BRANCH"
                CURRENT_BRANCH="$EXPECTED_BRANCH"
            else
                echo "⚠️  Could not create branch, continuing on $CURRENT_BRANCH"
            fi
        fi
    else
        echo "⚠️  Non-interactive mode - continuing on current branch"
        echo "💡 Create branch manually: git checkout -b $EXPECTED_BRANCH"
    fi
fi

# Update agent context with final branch name
if [ -f ".flowforge/local/agent-context.json" ] && command -v jq &> /dev/null; then
    FINAL_BRANCH=$(git branch --show-current 2>/dev/null || echo "unknown")
    jq ".session.branch = \"$FINAL_BRANCH\"" .flowforge/local/agent-context.json > .flowforge/local/agent-context.json.tmp && \
    mv .flowforge/local/agent-context.json.tmp .flowforge/local/agent-context.json
    echo "✅ Agent context updated with branch: $FINAL_BRANCH"
fi
```

## ⏱️ Step 5: Start Time Tracking
```bash
# Start time tracking for the issue
echo -e "\n⏱️  Starting time tracking..."

TIME_STARTED=false
SESSION_ID="session-$(date +%s)-$$"
USER_NAME="${USER:-$(whoami)}"

# Try provider system first for time tracking
if [ -n "$PROVIDER_BRIDGE" ] && command -v node &> /dev/null; then
    # Check provider capabilities
    PROVIDER_INFO=$(timeout 5 node "$PROVIDER_BRIDGE" get-provider --format=json 2>/dev/null || echo "{}")
    
    if echo "$PROVIDER_INFO" | grep -q '"timeTracking":\s*true'; then
        # Provider supports time tracking
        if timeout 5 node "$PROVIDER_BRIDGE" start-tracking --id="$TICKET_ID" --user="$USER_NAME" --instance="$SESSION_ID" --format=text 2>&1; then
            TIME_STARTED=true
            echo "✅ Time tracking started via provider system"
        else
            echo "⚠️  Provider time tracking failed, trying fallback..."
        fi
    fi
fi

# Start real-time session tracking (Issue #103)
REALTIME_STARTED=false
if [ -f "./scripts/realtime-tracker.js" ] && command -v node &> /dev/null; then
    echo "🔄 Initializing real-time session tracking..."
    
    # Get current branch for tracking
    CURRENT_BRANCH=$(git branch --show-current 2>/dev/null || echo "unknown")
    
    # Start real-time tracking
    if REALTIME_OUTPUT=$(node ./scripts/realtime-tracker.js start \
        --session-id="$SESSION_ID" \
        --task-id="$TICKET_ID" \
        --task-title="$TICKET_TITLE" \
        --user="$USER_NAME" \
        --branch="$CURRENT_BRANCH" \
        --enable-sync=true \
        --update-interval=30000 \
        --privacy-mode=false 2>&1); then
        
        REALTIME_STARTED=true
        echo "✅ Real-time tracking active (updates every 30s)"
        
        # Parse session data if jq is available
        if command -v jq &> /dev/null && [ -n "$REALTIME_OUTPUT" ]; then
            SESSION_ID=$(echo "$REALTIME_OUTPUT" | jq -r '.sessionId // "'$SESSION_ID'"' 2>/dev/null || echo "$SESSION_ID")
        fi
    else
        echo "⚠️  Real-time tracking setup failed (continuing with basic tracking)"
        [[ "${DEBUG:-0}" == "1" ]] && echo "Debug: $REALTIME_OUTPUT"
    fi
fi

# Fallback to traditional time tracking script
if [ "$TIME_STARTED" = false ]; then
    TIME_SCRIPT=""
    if [ -f "./scripts/task-time.sh" ]; then
        TIME_SCRIPT="./scripts/task-time.sh"
    elif [ -f "./.flowforge/scripts/task-time.sh" ]; then
        TIME_SCRIPT="./.flowforge/scripts/task-time.sh"
    fi
    
    if [ -n "$TIME_SCRIPT" ]; then
        # Start time tracking with error handling
        if "$TIME_SCRIPT" start "$TICKET_ID" 2>&1; then
            echo "✅ Time tracking started (traditional)"
            
            # Show current session status
            echo -e "\n📊 Current session status:"
            "$TIME_SCRIPT" status "$TICKET_ID" 2>&1 || echo "⚠️  Could not get status"
        else
            echo "⚠️  Could not start time tracking (continuing anyway)"
        fi
    else
        echo "⚠️  Time tracking not available"
        echo "💡 Time tracking helps measure productivity and ensures payment"
    fi
fi

# Save session data to JSON with enhanced provider integration
echo -e "\n💾 Saving enhanced session data..."
CURRENT_TIME=$(date -u +"%Y-%m-%dT%H:%M:%S.%3NZ")

# Save session data via provider bridge for consistency
if [ -n "$PROVIDER_BRIDGE" ] && command -v node &> /dev/null; then
    echo "🔄 Saving session via provider bridge..."

    # Use provider bridge to save session data
    if timeout 10 node "$PROVIDER_BRIDGE" save-session \
        --sessionId="$SESSION_ID" \
        --taskId="$TICKET_ID" \
        --taskTitle="$TICKET_TITLE" \
        --user="$USER_NAME" \
        --branch="${CURRENT_BRANCH:-unknown}" \
        --startTime="$CURRENT_TIME" \
        --format=json > /dev/null 2>&1; then
        echo "✅ Session data saved via provider bridge"
    else
        echo "⚠️  Provider bridge save failed, using direct save..."
    fi
fi

# Create comprehensive session JSON (always create local backup)
cat > .flowforge/local/session.json << EOF
{
  "sessionId": "$SESSION_ID",
  "taskId": "$TICKET_ID",
  "taskTitle": "$TICKET_TITLE",
  "taskStatus": "$TICKET_STATUS",
  "branch": "${CURRENT_BRANCH:-unknown}",
  "startTime": "$CURRENT_TIME",
  "user": "$USER_NAME",
  "detectionSource": "${DETECTION_SOURCE:-manual}",
  "lastActivity": "$CURRENT_TIME",
  "contextRestored": ${CONTEXT_RESTORED:-false},
  "realtimeTracking": ${REALTIME_STARTED:-false},
  "providerIntegration": true,
  "enhancedFeatures": {
    "contextRestoration": true,
    "tddIntegration": true,
    "agentCoordination": true,
    "multiDeveloperSupport": true
  }
}
EOF

# Verify the file was created successfully
if [ -f ".flowforge/local/session.json" ]; then
    # Validate JSON structure if jq is available
    if command -v jq &> /dev/null; then
        if jq empty .flowforge/local/session.json 2>/dev/null; then
            echo "✅ Enhanced session data saved and validated"

            # Log session start for analytics if available
            if [ -n "$PROVIDER_BRIDGE" ]; then
                timeout 5 node "$PROVIDER_BRIDGE" update-session \
                    --lastAction="Session started with enhanced features" \
                    --format=simple > /dev/null 2>&1 || true
            fi
        else
            echo "⚠️  Session data saved but may have JSON formatting issues"
        fi
    else
        echo "✅ Enhanced session data saved"
    fi
else
    echo "❌ Failed to save session data!"
    echo "💡 Check permissions on .flowforge/local directory"
fi
```

## 📁 Step 6: Update Ticket Status
```bash
# Update ticket status to in-progress if needed
if [ -n "$PROVIDER_BRIDGE" ] && command -v node &> /dev/null; then
    echo -e "\n📝 Updating ticket status..."

    # Check current status first to avoid unnecessary updates
    if CURRENT_STATUS=$(timeout 5 node "$PROVIDER_BRIDGE" get-task --id="$TICKET_ID" --format=json 2>/dev/null | jq -r '.status // "unknown"' 2>/dev/null); then
        if [[ "$CURRENT_STATUS" =~ ^(in_progress|active|started)$ ]]; then
            echo "✅ Ticket already in active state: $CURRENT_STATUS"
        else
            # Update to in_progress
            if timeout 10 node "$PROVIDER_BRIDGE" update-task --id="$TICKET_ID" --status=in_progress --assignee=me 2>&1; then
                echo "✅ Ticket status updated to in_progress"
                TICKET_STATUS="in_progress"
            else
                echo "⚠️  Could not update ticket status (continuing anyway)"
            fi
        fi
    else
        echo "⚠️  Could not check current ticket status (continuing anyway)"
    fi

    # Update session data with provider context
    if [ -f ".flowforge/local/session.json" ] && command -v jq &> /dev/null; then
        jq --arg provider "$ACTIVE_PROVIDER" --arg status "$TICKET_STATUS" \
           '.provider = $provider | .taskStatus = $status | .lastActivity = now | .providerSync = true' \
           .flowforge/local/session.json > .flowforge/local/session.json.tmp && \
        mv .flowforge/local/session.json.tmp .flowforge/local/session.json
    fi
fi
```

## 🧪 Step 7: Enhanced Context Restoration (Issue #544)
```bash
# Enhanced context restoration with intelligent analysis using dedicated script
echo -e "\n📍 Performing enhanced context restoration..."

# Use the dedicated enhanced context restoration script
if [ -f "scripts/enhanced-context-restoration.sh" ]; then
    # Run complete context restoration
    ./scripts/enhanced-context-restoration.sh main "$TICKET_ID" "${CURRENT_BRANCH:-unknown}" "$SESSION_ID"

    # Check if context was successfully restored
    if [ -f ".flowforge/local/session-context.json" ]; then
        CONTEXT_RESTORED=true
        echo -e "\n✅ Enhanced context restoration completed successfully"
    else
        CONTEXT_RESTORED=false
        echo -e "\n⚠️  Context restoration completed with warnings"
    fi
else
    # Fallback to basic context restoration
    echo "⚠️  Enhanced context restoration script not found, using basic restoration..."
    CONTEXT_RESTORED=false

    # Basic context preservation fallback
    if [ -f "scripts/context-preservation.sh" ]; then
        echo "🔄 Using basic context preservation..."
        CONTEXT_OUTPUT=$(./scripts/context-preservation.sh restore 2>&1 || true)

        if echo "$CONTEXT_OUTPUT" | grep -q "Files you were working on:"; then
            echo "$CONTEXT_OUTPUT"
            CONTEXT_RESTORED=true
        fi
    else
        echo "ℹ️  No context preservation available"
    fi
fi

# Ensure TDD context is available for agent coordination
TDD_CONTEXT_FILE=".flowforge/local/tdd-context.json"
if [ ! -f "$TDD_CONTEXT_FILE" ]; then
    echo -e "\n🧪 Creating TDD context for agent coordination..."

    # Create basic TDD context if enhanced script didn't run
    cat > "$TDD_CONTEXT_FILE" << EOF
{
  "tddRequired": true,
  "ticketId": "$TICKET_ID",
  "testFiles": [
    "tests/commands/session/start.test.js",
    "tests/integration/session-start.test.js",
    "tests/unit/test-session-start-comprehensive.bats"
  ],
  "testFrameworks": ["bats", "jest", "mocha"],
  "coverageTarget": 80,
  "workflow": "RED_GREEN_REFACTOR",
  "instructions": {
    "rule3": "Write tests BEFORE code - FlowForge Rule #3",
    "readTestsFirst": "Always read existing tests before implementing",
    "makeTestsPass": "Ensure all existing tests pass before adding features",
    "maintainCoverage": "Maintain 80%+ test coverage"
  },
  "timestamp": "$(date -u +"%Y-%m-%dT%H:%M:%S.%3NZ")"
}
EOF
    echo "✅ Basic TDD context created"
fi
```

## 🧪 Step 8: Run Pre-Flight Checks
```bash
# Run various checks to ensure environment is ready
echo -e "\n🧪 Running pre-flight checks..."

# Check for uncommitted changes
if UNCOMMITTED=$(git status --porcelain 2>/dev/null | wc -l); then
    if [ "$UNCOMMITTED" -gt 0 ]; then
        echo "⚠️  You have $UNCOMMITTED uncommitted changes"
        echo "💡 Consider committing or stashing before starting new work"
        git status --short 2>/dev/null | head -10
    else
        echo "✅ Working directory clean"
    fi
else
    echo "⚠️  Could not check git status"
fi

# Check if tests exist and run them
if [ -f "package.json" ] && grep -q '"test"' package.json 2>/dev/null; then
    echo -e "\n🧪 Running tests..."
    if command -v npm &> /dev/null; then
        npm test -- --run 2>&1 | tail -10 || echo "⚠️  Some tests may be failing"
    else
        echo "⚠️  npm not found - skipping tests"
    fi
elif [ -f "Makefile" ] && grep -q "^test:" Makefile 2>/dev/null; then
    echo -e "\n🧪 Running tests..."
    if command -v make &> /dev/null; then
        make test 2>&1 | tail -10 || echo "⚠️  Some tests may be failing"
    else
        echo "⚠️  make not found - skipping tests"
    fi
else
    echo "ℹ️  No test suite detected"
fi

# Check FlowForge rules compliance
if [ -f ".flowforge/hooks/enforce-all-rules.sh" ]; then
    echo -e "\n📋 Checking FlowForge rules..."
    if .flowforge/hooks/enforce-all-rules.sh "start-work" 2>&1 | grep -E "(✅|❌|⚠️)"; then
        :  # Success
    else
        echo "⚠️  Could not check FlowForge rules"
    fi
fi
```

## 📚 Step 9: Enhanced Context Display & Agent Coordination Setup
```bash
# Display helpful context and summary
echo -e "\n════════════════════════════════════════"
echo "✨ SESSION READY FOR TICKET #$TICKET_ID"
echo "════════════════════════════════════════"

echo -e "\n📚 Key Context Files:"
echo "• CLAUDE.md - Project context"
echo "• .flowforge/RULES.md - Development rules"  
echo "• .flowforge/local/session.json - Session data"
echo "• .flowforge/data/tasks.json - Task tracking"

echo -e "\n🔧 Useful Commands:"
echo "• /tdd - Start test-driven development"
echo "• /flowforge:dev:checkrules - Verify rule compliance"
echo "• /flowforge:session:end \"message\" - End session with notes"
if [ "$ACTIVE_PROVIDER" = "GitHub" ]; then
    echo "• gh issue comment $TICKET_ID -b \"Update\" - Add GitHub comment"
else
    echo "• Update ticket in $ACTIVE_PROVIDER via provider tools"
fi

echo -e "\n📋 FlowForge Reminders:"
echo "• Rule #2: Present 3 options before implementing"
echo "• Rule #3: Write tests BEFORE code (TDD)"
echo "• Rule #18: Never work directly on main/develop"
echo "• Rule #12: Cannot close tasks without approval"

echo -e "\n🚀 You're all set! Time tracking is active."
echo "💡 Start with: Read the issue requirements carefully"

# TDD Agent Coordination Setup (Issue #544)
echo -e "\n🤖 Setting up TDD-First Agent Coordination..."
TDD_CONTEXT_FILE=".flowforge/local/tdd-context.json"

# Prepare TDD context for future agent spawns
cat > "$TDD_CONTEXT_FILE" << EOF
{
  "tddRequired": true,
  "testLocations": [
    "tests/commands/session/start.test.js",
    "tests/integration/session-start.test.js",
    "tests/unit/test-session-start-comprehensive.bats"
  ],
  "testFrameworks": ["bats", "jest", "mocha"],
  "coverageTarget": 80,
  "sessionData": {
    "ticketId": "$TICKET_ID",
    "branch": "${CURRENT_BRANCH:-unknown}",
    "sessionId": "$SESSION_ID",
    "contextRestored": $CONTEXT_RESTORED
  },
  "agentInstructions": {
    "testFirst": "Always read existing tests before implementing code",
    "makeTestsPass": "Ensure all existing tests pass before adding new features",
    "minimumCoverage": "Maintain 80%+ test coverage (Rule #3)",
    "tddWorkflow": "RED -> GREEN -> REFACTOR cycle mandatory"
  }
}
EOF

echo "✅ TDD context prepared for agent coordination"
echo "📋 Future agents will receive test-first instructions"
echo ""

# Display task details if available
if [ -n "$TICKET_TITLE" ] && [ "$TICKET_TITLE" != "Unknown" ]; then
    echo -e "\n📄 Working on:"
    echo "════════════════════════════════════════════"
    echo "📌 Ticket #$TICKET_ID: $TICKET_TITLE"
    echo "📊 Status: $TICKET_STATUS"
    echo "🏢 Provider: ${ACTIVE_PROVIDER:-Unknown}"
    echo "🌿 Branch: ${CURRENT_BRANCH:-unknown}"
    echo "⏱️  Session: $SESSION_ID"
    echo "════════════════════════════════════════════"
fi

# Save current position for seamless resume
if [ -f "scripts/position-tracker.sh" ] && [ -n "$TICKET_ID" ]; then
    echo -e "\n💾 Saving position for seamless resume..."
    ./scripts/position-tracker.sh save "$TICKET_ID" "" "Started session" "Working on ${ACTIVE_PROVIDER:-Provider} ticket #$TICKET_ID"
fi

# Save initial context with provider information
if [ -f "scripts/context-preservation.sh" ] && [ -n "$TICKET_ID" ]; then
    # Save context with enhanced provider info
    export FLOWFORGE_TICKET="$TICKET_ID"
    export FLOWFORGE_PROVIDER="${ACTIVE_PROVIDER:-Unknown}"
    export FLOWFORGE_LAST_ACTION="Started work session for ticket #$TICKET_ID"
    export FLOWFORGE_CURRENT_FILES=""
    ./scripts/context-preservation.sh save > /dev/null 2>&1
fi

# Exit successfully
exit 0
```

## 🎯 Success!
Your session is now active and configured for maximum productivity. FlowForge is tracking your time and ensuring compliance with all development standards.

**Next Steps:**
1. Review the issue requirements shown above
2. Use `/tdd` to start test-driven development
3. Commit frequently with descriptive messages
4. Run `/flowforge:session:end "summary"` when done