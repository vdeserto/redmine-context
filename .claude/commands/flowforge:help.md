# Command: flowforge:flowforge:help
# Version: 2.0.0
# Description: FlowForge flowforge help command

---
description: Show all FlowForge commands organized by category
argument-hint: "[category] (optional: session, dev, project, agent, version)"
---

# 🚀 FlowForge Command Help

## 📋 Display Help
```bash
# Enable strict error handling
set -euo pipefail

# Error handling function
handle_error() {
    local exit_code=$?
    local line_number=$1
    echo "❌ Error on line $line_number (exit code: $exit_code)" >&2
    exit $exit_code
}

# Set up error trap
trap 'handle_error $LINENO' ERR

# Validate and sanitize input
validate_category() {
    local category="$1"
    
    # Check if category is empty (allow this as default)
    if [ -z "$category" ]; then
        echo "all"
        return 0
    fi
    
    # Check for multiple arguments (space-separated)
    if [[ "$category" =~ [[:space:]] ]]; then
        echo "❌ Error: Multiple arguments not supported" >&2
        echo "Usage: /flowforge:help [category]" >&2
        echo "Available categories: session, dev, project, agent, version" >&2
        exit 1
    fi
    
    # Check category length (prevent extremely long inputs)
    if [ ${#category} -gt 50 ]; then
        echo "❌ Error: Category name too long (max 50 characters)" >&2
        echo "Available categories: session, dev, project, agent, version" >&2
        exit 1
    fi
    
    # Check for special characters that could cause issues
    if [[ "$category" =~ [^a-zA-Z0-9_-] ]]; then
        echo "❌ Error: Invalid characters in category name" >&2
        echo "Available categories: session, dev, project, agent, version" >&2
        exit 1
    fi
    
    # Validate against known categories
    case "$category" in
        "all"|"session"|"dev"|"project"|"agent"|"version")
            echo "$category"
            return 0
            ;;
        *)
            echo "❌ Error: Unknown category '$category'" >&2
            echo "Available categories: session, dev, project, agent, version" >&2
            exit 1
            ;;
    esac
}

# Check if help documentation is available
check_help_availability() {
    # Check if we're in a FlowForge project (optional check)
    if [ ! -d ".flowforge" ] && [ ! -f "commands/flowforge/help.md" ]; then
        echo "⚠️  Warning: Not in a FlowForge project directory" >&2
        echo "   Help may be limited outside of FlowForge projects" >&2
    fi
    
    # Check if we can read help files (if they exist)
    local help_files=(
        "commands/flowforge/help.md"
        "commands/flowforge/session/start.md"
        "commands/flowforge/dev/tdd.md"
    )
    
    for file in "${help_files[@]}"; do
        if [ -f "$file" ] && [ ! -r "$file" ]; then
            echo "❌ Error: Cannot read help documentation at $file" >&2
            echo "   Check file permissions and try again" >&2
            exit 1
        fi
    done
}

# Parse and validate help request
CATEGORY_RAW="${ARGUMENTS:-}"
CATEGORY=$(validate_category "$CATEGORY_RAW")

# Check help system availability
check_help_availability

# Show header with error handling for terminal display
show_header() {
    cat << 'HEADER'
╔═══════════════════════════════════════════════════════════════╗
║                    🚀 FlowForge Commands                      ║
║                 Your AI Development Partner                    ║
╚═══════════════════════════════════════════════════════════════╝

FlowForge helps you build better software with AI by enforcing
best practices, automating workflows, and maintaining quality.

HEADER
}

# Function to show command info with error handling
show_command() {
    local cmd="$1"
    local desc="$2"
    local args="${3:-}"
    
    # Validate inputs
    if [ -z "$cmd" ] || [ -z "$desc" ]; then
        echo "⚠️  Warning: Incomplete command documentation" >&2
        return 1
    fi
    
    # Use printf with error handling
    if ! printf "  %-35s %s\n" "$cmd" "$desc" 2>/dev/null; then
        echo "  $cmd - $desc"
    fi
    
    if [ -n "$args" ]; then
        if ! printf "  %-35s %s\n" "" "└─ $args" 2>/dev/null; then
            echo "    └─ $args"
        fi
    fi
}

# Display header
if ! show_header; then
    echo "⚠️  Warning: Header display failed, continuing with simple format" >&2
fi

# Show commands based on category with error handling
display_category() {
    local cat="$1"
    
    case "$cat" in
        session|all)
            if [ "$cat" = "session" ] || [ "$cat" = "all" ]; then
                echo "📅 Session Management"
                echo "────────────────────────────────────────────────────────────────"
                show_command "/flowforge:session:start" "Begin work with intelligent task detection" "[issue]"
                show_command "/flowforge:session:pause" "Quick pause for task switching"
                show_command "/flowforge:session:end" "Complete session with cleanup" "[message]"
                echo ""
            fi
            ;;&
            
        dev|all)
            if [ "$cat" = "dev" ] || [ "$cat" = "all" ]; then
                echo "🛠️  Development Tools"
                echo "────────────────────────────────────────────────────────────────"
                show_command "/flowforge:dev:tdd" "Start Test-Driven Development workflow" "[feature]"
                show_command "/flowforge:dev:checkrules" "Verify FlowForge rule compliance"
                show_command "/flowforge:dev:status" "Show comprehensive project status"
                echo ""
            fi
            ;;&
            
        project|all)
            if [ "$cat" = "project" ] || [ "$cat" = "all" ]; then
                echo "📁 Project Management"
                echo "────────────────────────────────────────────────────────────────"
                show_command "/flowforge:project:setup" "One-time project setup wizard"
                show_command "/flowforge:project:plan" "Plan features with task breakdown" "[feature]"
                show_command "/flowforge:project:tasks" "Generate task reports" "[filter]"
                echo ""
            fi
            ;;&
            
        agent|all)
            if [ "$cat" = "agent" ] || [ "$cat" = "all" ]; then
                echo "🤖 Agent Management"
                echo "────────────────────────────────────────────────────────────────"
                show_command "/flowforge:agent:manage" "List, install, remove agents" "[action]"
                show_command "/flowforge:agent:create" "Create new FlowForge agent" "[name]"
                echo ""
            fi
            ;;&
            
        version|all)
            if [ "$cat" = "version" ] || [ "$cat" = "all" ]; then
                echo "📦 Version Management"
                echo "────────────────────────────────────────────────────────────────"
                show_command "/flowforge:version:check" "Show FlowForge version info"         
                show_command "/flowforge:version:update" "Update to latest FlowForge"
                show_command "/flowforge:version:enable" "Enable project versioning"
                echo ""
            fi
            ;;&
    esac
}

# Display the requested category
if ! display_category "$CATEGORY"; then
    echo "❌ Error: Failed to display help for category '$CATEGORY'" >&2
    exit 1
fi

# Show footer with tips
show_footer() {
    cat << 'FOOTER'

💡 Tips:
• Add ? to any command for detailed help (e.g., /flowforge:session:start ?)
• Commands are namespaced to avoid conflicts with your commands
• Start your day with: /flowforge:session:start
• End your day with: /flowforge:session:end

📚 Learn more:
• Documentation: /flowforge:project:setup (first time)
• Check rules: /flowforge:dev:checkrules
• View agents: /flowforge:agent:manage list

🚀 FlowForge: Building Better Software, Together with AI
FOOTER
}

# Display footer
if ! show_footer; then
    echo "⚠️  Warning: Footer display failed" >&2
fi

# Success exit
exit 0
```