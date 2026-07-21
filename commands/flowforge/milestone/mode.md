#!/bin/bash
# FlowForge Milestone Mode Command
# /flowforge:milestone:mode - Enables parallel development using Git worktrees
# Usage: /flowforge:milestone:mode [enable|disable|status|setup] [options]

```bash
#!/bin/bash
set -euo pipefail

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# Script location detection
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || echo "")"

# Configuration files
MILESTONE_CONTEXT_FILE=".milestone-context"
WORKTREE_CONFIG_FILE=".flowforge/worktree.json"

# Help text
show_help() {
    cat << EOF
${BOLD}${BLUE}🎯 FlowForge Milestone Mode${NC}
${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}

${BOLD}DESCRIPTION:${NC}
    Enable parallel development using Git worktrees for milestone-based work.
    This mode changes branch naming patterns and provides visual indicators.

${BOLD}USAGE:${NC}
    ${GREEN}/flowforge:milestone:mode${NC} [command] [options]

${BOLD}COMMANDS:${NC}
    ${CYAN}enable <milestone>${NC}
        Activate milestone mode for current directory
        - Creates .milestone-context file
        - Configures milestone branching pattern
        - Sets up visual indicators
        
    ${CYAN}disable${NC}
        Deactivate milestone mode
        - Removes configuration files
        - Clears git config settings
        - Shows transition guidance
        
    ${CYAN}status${NC}
        Show current milestone configuration
        - Display enabled state
        - List milestone branches
        - Show worktree information
        
    ${CYAN}setup <milestone> [path]${NC}
        Create new worktree for milestone (advanced)
        - Creates separate working directory
        - Enables parallel development
        - Isolates milestone work
        
    ${CYAN}(no arguments)${NC}
        Interactive mode with menu selection

${BOLD}BRANCH PATTERNS:${NC}
    ${YELLOW}Normal mode:${NC}    feature/<issue>-work
    ${YELLOW}Milestone mode:${NC} milestone/<name>/issue/<number>

${BOLD}VISUAL INDICATORS:${NC}
    When enabled, your terminal prompt will show:
    ${PURPLE}[M:milestone-name]${NC} - Active milestone indicator
    
${BOLD}EXAMPLES:${NC}
    ${GREEN}# Enable milestone mode for v2.0-team-balanced${NC}
    /flowforge:milestone:mode enable v2.0-team-balanced
    
    ${GREEN}# Check current status${NC}
    /flowforge:milestone:mode status
    
    ${GREEN}# Create new worktree for milestone${NC}
    /flowforge:milestone:mode setup v3.0-security ../FF-Security
    
    ${GREEN}# Disable milestone mode${NC}
    /flowforge:milestone:mode disable

${BOLD}INTEGRATION:${NC}
    • ${CYAN}session:start${NC} automatically uses milestone branching when enabled
    • ${CYAN}session:end${NC} respects milestone configuration
    • ${CYAN}project:tasks${NC} filters by milestone when active

${BOLD}TIPS:${NC}
    ${YELLOW}💡${NC} Use worktrees for truly parallel development
    ${YELLOW}💡${NC} Each milestone can have its own workspace
    ${YELLOW}💡${NC} Visual indicators help prevent context confusion
    ${YELLOW}💡${NC} Milestone branches merge to main when complete

${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}
EOF
}

# Check if we're in a git repository
check_git_repo() {
    if [[ -z "$PROJECT_ROOT" ]]; then
        echo -e "${RED}❌ Error: Not in a git repository${NC}"
        echo -e "${YELLOW}Please run this command from within a FlowForge project${NC}"
        exit 1
    fi
}

# Enable milestone mode
enable_milestone_mode() {
    local milestone="${1:-}"
    
    if [[ -z "$milestone" ]]; then
        echo -e "${RED}❌ Error: Milestone name required${NC}"
        echo -e "${YELLOW}Usage: /flowforge:milestone:mode enable <milestone-name>${NC}"
        exit 1
    fi
    
    check_git_repo
    
    # Validate milestone name (alphanumeric, dots, dashes)
    if [[ ! "$milestone" =~ ^[a-zA-Z0-9.-]+$ ]]; then
        echo -e "${RED}❌ Error: Invalid milestone name${NC}"
        echo -e "${YELLOW}Milestone names should only contain letters, numbers, dots, and dashes${NC}"
        exit 1
    fi
    
    echo -e "${BLUE}🎯 Enabling milestone mode for: ${BOLD}$milestone${NC}"
    echo ""
    
    # Check if already enabled
    if [[ -f "$PROJECT_ROOT/$MILESTONE_CONTEXT_FILE" ]]; then
        existing_milestone=$(cat "$PROJECT_ROOT/$MILESTONE_CONTEXT_FILE" 2>/dev/null || echo "")
        if [[ "$existing_milestone" == "$milestone" ]]; then
            echo -e "${YELLOW}⚠️  Milestone mode already enabled for: $milestone${NC}"
            echo -e "${CYAN}💡 Tip: Use 'status' to see current configuration${NC}"
            exit 0
        else
            echo -e "${YELLOW}⚠️  Switching from milestone: $existing_milestone${NC}"
        fi
    fi
    
    # Create .milestone-context file
    echo "$milestone" > "$PROJECT_ROOT/$MILESTONE_CONTEXT_FILE"
    echo -e "${GREEN}✅ Created $MILESTONE_CONTEXT_FILE${NC}"
    
    # Create .flowforge directory if it doesn't exist
    mkdir -p "$PROJECT_ROOT/.flowforge"
    
    # Create worktree.json configuration
    cat > "$PROJECT_ROOT/$WORKTREE_CONFIG_FILE" << EOF
{
  "milestone": "$milestone",
  "enabled": true,
  "branch_pattern": "milestone/$milestone/issue/{issue}",
  "base_branch": "milestone/$milestone",
  "merge_target": "main",
  "created": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "created_by": "$(git config user.name || echo "unknown")"
}
EOF
    echo -e "${GREEN}✅ Created $WORKTREE_CONFIG_FILE${NC}"
    
    # Set git config for visual indicators
    git config --local flowforge.milestone "$milestone"
    git config --local flowforge.milestone-mode enabled
    echo -e "${GREEN}✅ Configured git settings${NC}"
    
    # Create or checkout milestone branch
    local milestone_branch="milestone/$milestone"
    if git show-ref --verify --quiet "refs/heads/$milestone_branch"; then
        echo -e "${BLUE}📌 Milestone branch exists: $milestone_branch${NC}"
    else
        echo -e "${BLUE}📌 Creating milestone branch: $milestone_branch${NC}"
        # Get the current branch to use as base
        current_branch=$(git rev-parse --abbrev-ref HEAD)
        if [[ "$current_branch" == "main" ]] || [[ "$current_branch" == "develop" ]]; then
            git checkout -b "$milestone_branch"
            echo -e "${GREEN}✅ Created and checked out $milestone_branch${NC}"
        else
            echo -e "${YELLOW}⚠️  Not on main/develop branch${NC}"
            echo -e "${CYAN}💡 Create milestone branch manually from main:${NC}"
            echo -e "   ${BOLD}git checkout main && git checkout -b $milestone_branch${NC}"
        fi
    fi
    
    echo ""
    echo -e "${GREEN}${BOLD}✨ Milestone mode enabled successfully!${NC}"
    echo ""
    echo -e "${PURPLE}🎨 Visual Indicator Setup:${NC}"
    echo -e "   Your terminal should now show: ${PURPLE}[M:$milestone]${NC}"
    echo ""
    echo -e "${CYAN}📋 Next Steps:${NC}"
    echo -e "   1. Start a session: ${BOLD}/flowforge:session:start <issue>${NC}"
    echo -e "   2. Branches will use: ${BOLD}milestone/$milestone/issue/<number>${NC}"
    echo -e "   3. All work isolated to this milestone"
    echo ""
    echo -e "${YELLOW}💡 Pro Tip:${NC} For true parallel development, use:"
    echo -e "   ${BOLD}/flowforge:milestone:mode setup $milestone [path]${NC}"
}

# Disable milestone mode
disable_milestone_mode() {
    check_git_repo
    
    if [[ ! -f "$PROJECT_ROOT/$MILESTONE_CONTEXT_FILE" ]]; then
        echo -e "${YELLOW}⚠️  Milestone mode is not currently enabled${NC}"
        exit 0
    fi
    
    local current_milestone=$(cat "$PROJECT_ROOT/$MILESTONE_CONTEXT_FILE" 2>/dev/null || echo "")
    
    echo -e "${BLUE}🎯 Disabling milestone mode${NC}"
    if [[ -n "$current_milestone" ]]; then
        echo -e "   Current milestone: ${BOLD}$current_milestone${NC}"
    fi
    echo ""
    
    # Remove configuration files
    rm -f "$PROJECT_ROOT/$MILESTONE_CONTEXT_FILE"
    echo -e "${GREEN}✅ Removed $MILESTONE_CONTEXT_FILE${NC}"
    
    rm -f "$PROJECT_ROOT/$WORKTREE_CONFIG_FILE"
    echo -e "${GREEN}✅ Removed $WORKTREE_CONFIG_FILE${NC}"
    
    # Clear git config settings
    git config --local --unset flowforge.milestone 2>/dev/null || true
    git config --local --unset flowforge.milestone-mode 2>/dev/null || true
    echo -e "${GREEN}✅ Cleared git configuration${NC}"
    
    echo ""
    echo -e "${GREEN}${BOLD}✨ Milestone mode disabled successfully!${NC}"
    echo ""
    echo -e "${CYAN}📋 Transition Information:${NC}"
    echo -e "   • Future branches will use: ${BOLD}feature/<issue>-work${NC}"
    echo -e "   • Existing milestone branches remain unchanged"
    echo -e "   • You can re-enable anytime with: ${BOLD}/flowforge:milestone:mode enable <milestone>${NC}"
    
    # Check if we're on a milestone branch
    current_branch=$(git rev-parse --abbrev-ref HEAD)
    if [[ "$current_branch" == milestone/* ]]; then
        echo ""
        echo -e "${YELLOW}⚠️  You're still on a milestone branch: $current_branch${NC}"
        echo -e "${CYAN}💡 Consider switching to main or a feature branch${NC}"
    fi
}

# Show milestone status
show_milestone_status() {
    check_git_repo
    
    echo -e "${BLUE}${BOLD}🎯 FlowForge Milestone Status${NC}"
    echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
    
    # Check if milestone mode is enabled
    if [[ -f "$PROJECT_ROOT/$MILESTONE_CONTEXT_FILE" ]]; then
        local milestone=$(cat "$PROJECT_ROOT/$MILESTONE_CONTEXT_FILE" 2>/dev/null || echo "")
        echo -e "${GREEN}✅ Milestone Mode: ${BOLD}ENABLED${NC}"
        echo -e "   Milestone: ${PURPLE}${BOLD}$milestone${NC}"
        
        # Show configuration if exists
        if [[ -f "$PROJECT_ROOT/$WORKTREE_CONFIG_FILE" ]]; then
            echo ""
            echo -e "${CYAN}📋 Configuration:${NC}"
            # Parse JSON manually (avoiding jq dependency)
            while IFS= read -r line; do
                if [[ "$line" =~ \"([^\"]+)\":\ *\"([^\"]+)\" ]]; then
                    key="${BASH_REMATCH[1]}"
                    value="${BASH_REMATCH[2]}"
                    printf "   %-15s: %s\n" "$key" "$value"
                fi
            done < "$PROJECT_ROOT/$WORKTREE_CONFIG_FILE"
        fi
        
        # Show git config
        local git_milestone=$(git config --local flowforge.milestone 2>/dev/null || echo "")
        local git_mode=$(git config --local flowforge.milestone-mode 2>/dev/null || echo "")
        if [[ -n "$git_milestone" ]]; then
            echo ""
            echo -e "${CYAN}🔧 Git Configuration:${NC}"
            echo -e "   flowforge.milestone: $git_milestone"
            echo -e "   flowforge.milestone-mode: $git_mode"
        fi
    else
        echo -e "${YELLOW}⚠️  Milestone Mode: ${BOLD}DISABLED${NC}"
        echo -e "   Using standard branch pattern: ${BOLD}feature/<issue>-work${NC}"
    fi
    
    # Show current branch
    echo ""
    echo -e "${CYAN}📌 Current Branch:${NC}"
    local current_branch=$(git rev-parse --abbrev-ref HEAD)
    if [[ "$current_branch" == milestone/* ]]; then
        echo -e "   ${PURPLE}$current_branch${NC} (milestone branch)"
    else
        echo -e "   $current_branch"
    fi
    
    # List milestone branches
    echo ""
    echo -e "${CYAN}🌿 Milestone Branches:${NC}"
    local milestone_branches=$(git branch -a | grep -E "milestone/" | sed 's/^[* ]*//' | sed 's/remotes\/origin\///' | sort -u)
    if [[ -n "$milestone_branches" ]]; then
        echo "$milestone_branches" | while read -r branch; do
            if [[ "$branch" == "$current_branch" ]]; then
                echo -e "   ${GREEN}→ $branch${NC} (current)"
            else
                echo -e "   • $branch"
            fi
        done
    else
        echo -e "   ${YELLOW}No milestone branches found${NC}"
    fi
    
    # Check for worktrees
    echo ""
    echo -e "${CYAN}🔀 Git Worktrees:${NC}"
    local worktrees=$(git worktree list 2>/dev/null | tail -n +2)
    if [[ -n "$worktrees" ]]; then
        echo "$worktrees" | while read -r line; do
            echo -e "   • $line"
        done
    else
        echo -e "   ${YELLOW}No additional worktrees configured${NC}"
        echo -e "   ${CYAN}💡 Create one with: ${BOLD}/flowforge:milestone:mode setup <milestone>${NC}"
    fi
    
    echo ""
    echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
}

# Setup milestone worktree
setup_milestone_worktree() {
    local milestone="${1:-}"
    local worktree_path="${2:-}"
    
    if [[ -z "$milestone" ]]; then
        echo -e "${RED}❌ Error: Milestone name required${NC}"
        echo -e "${YELLOW}Usage: /flowforge:milestone:mode setup <milestone> [path]${NC}"
        exit 1
    fi
    
    check_git_repo
    
    # Check if setup script exists
    local setup_script="$PROJECT_ROOT/scripts/setup-milestone-worktree.sh"
    if [[ -f "$setup_script" ]]; then
        echo -e "${BLUE}🎯 Using existing setup script${NC}"
        if [[ -n "$worktree_path" ]]; then
            bash "$setup_script" "$milestone" "$worktree_path"
        else
            bash "$setup_script" "$milestone"
        fi
    else
        # Inline worktree creation logic
        echo -e "${BLUE}🎯 Setting up milestone worktree: ${BOLD}$milestone${NC}"
        
        # Default path if not provided
        if [[ -z "$worktree_path" ]]; then
            worktree_path="../FlowForge-$milestone"
        fi
        
        # Create absolute path
        worktree_path=$(cd "$(dirname "$worktree_path")" 2>/dev/null && pwd)/$(basename "$worktree_path")
        
        # Check if worktree already exists
        if [[ -d "$worktree_path" ]]; then
            echo -e "${RED}❌ Error: Directory already exists: $worktree_path${NC}"
            exit 1
        fi
        
        # Create milestone branch if it doesn't exist
        local milestone_branch="milestone/$milestone"
        if ! git show-ref --verify --quiet "refs/heads/$milestone_branch"; then
            echo -e "${BLUE}📌 Creating milestone branch: $milestone_branch${NC}"
            git branch "$milestone_branch" main
        fi
        
        # Create worktree
        echo -e "${BLUE}🔀 Creating worktree at: $worktree_path${NC}"
        git worktree add "$worktree_path" "$milestone_branch"
        
        # Setup milestone mode in the worktree
        cd "$worktree_path"
        echo "$milestone" > "$MILESTONE_CONTEXT_FILE"
        mkdir -p .flowforge
        
        # Create worktree configuration
        cat > "$WORKTREE_CONFIG_FILE" << EOF
{
  "milestone": "$milestone",
  "enabled": true,
  "branch_pattern": "milestone/$milestone/issue/{issue}",
  "base_branch": "milestone/$milestone",
  "merge_target": "main",
  "created": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "created_by": "$(git config user.name || echo "unknown")",
  "worktree": true,
  "worktree_path": "$worktree_path"
}
EOF
        
        # Set git config
        git config --local flowforge.milestone "$milestone"
        git config --local flowforge.milestone-mode enabled
        
        echo ""
        echo -e "${GREEN}${BOLD}✨ Worktree created successfully!${NC}"
        echo ""
        echo -e "${CYAN}📋 Next Steps:${NC}"
        echo -e "   1. ${BOLD}cd $worktree_path${NC}"
        echo -e "   2. ${BOLD}./run_ff_command.sh flowforge:session:start <issue>${NC}"
        echo -e "   3. Work in parallel with other milestones!"
    fi
}

# Interactive mode
interactive_mode() {
    echo -e "${BLUE}${BOLD}🎯 FlowForge Milestone Mode - Interactive${NC}"
    echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
    echo -e "${CYAN}Select an option:${NC}"
    echo ""
    echo -e "  ${BOLD}1)${NC} Enable milestone mode"
    echo -e "  ${BOLD}2)${NC} Disable milestone mode"
    echo -e "  ${BOLD}3)${NC} Show status"
    echo -e "  ${BOLD}4)${NC} Setup worktree (advanced)"
    echo -e "  ${BOLD}5)${NC} Show help"
    echo -e "  ${BOLD}6)${NC} Exit"
    echo ""
    
    read -p "$(echo -e "${CYAN}Enter choice [1-6]: ${NC}")" choice
    
    case $choice in
        1)
            echo ""
            read -p "$(echo -e "${CYAN}Enter milestone name: ${NC}")" milestone_name
            enable_milestone_mode "$milestone_name"
            ;;
        2)
            echo ""
            disable_milestone_mode
            ;;
        3)
            echo ""
            show_milestone_status
            ;;
        4)
            echo ""
            read -p "$(echo -e "${CYAN}Enter milestone name: ${NC}")" milestone_name
            read -p "$(echo -e "${CYAN}Enter worktree path (or press Enter for default): ${NC}")" worktree_path
            setup_milestone_worktree "$milestone_name" "$worktree_path"
            ;;
        5)
            echo ""
            show_help
            ;;
        6)
            echo -e "${GREEN}👋 Goodbye!${NC}"
            exit 0
            ;;
        *)
            echo -e "${RED}❌ Invalid choice${NC}"
            exit 1
            ;;
    esac
}

# Main command processing
main() {
    # Handle arguments from environment variable (FlowForge runner) or command line
    local args_array=()
    if [[ -n "${ARGUMENTS:-}" ]]; then
        # Split ARGUMENTS environment variable into array
        read -ra args_array <<< "$ARGUMENTS"
    else
        # Use command line arguments
        args_array=("$@")
    fi
    
    local command="${args_array[0]:-}"
    
    case "$command" in
        enable)
            enable_milestone_mode "${args_array[1]:-}"
            ;;
        disable)
            disable_milestone_mode
            ;;
        status)
            show_milestone_status
            ;;
        setup)
            setup_milestone_worktree "${args_array[1]:-}" "${args_array[2]:-}"
            ;;
        --help|-h|help)
            show_help
            ;;
        "")
            interactive_mode
            ;;
        *)
            echo -e "${RED}❌ Unknown command: $command${NC}"
            echo -e "${YELLOW}Use --help to see available commands${NC}"
            exit 1
            ;;
    esac
}

# Run main function with all arguments
main "$@"
```