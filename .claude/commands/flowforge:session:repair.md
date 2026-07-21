# Command: flowforge:session:repair
# Version: 2.0.0
# Description: Auto-repair common session issues

---
description: Automatically detect and repair common FlowForge session issues
argument-hint: "[auto|interactive]"
---

# 🔧 Session Auto-Repair

## 📋 Detecting and Fixing Issues
```bash
set -euo pipefail

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
GRAY='\033[0;90m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# Check for help request
if [[ "${ARGUMENTS:-}" == "?" || "${ARGUMENTS:-}" == "help" ]]; then
    cat << 'HELP'
🔧 FlowForge Session Auto-Repair

Usage: /flowforge:session:repair [mode]

What it does:
✓ Detects common session issues
✓ Automatically fixes problems
✓ Rebuilds corrupted files
✓ Restores session state
✓ Validates repairs

Modes:
  auto         Automatic repair (default)
  interactive  Ask before each repair
  force        Force repair even if healthy
  ?/help       Show this help

Issues it can fix:
• Corrupted session files
• Missing directories
• Timer not running
• Wrong git branch
• Uncommitted changes
• Provider system issues
• GitHub CLI authentication

After repair:
- Green items were fixed
- Yellow items need manual intervention
- Red items couldn't be fixed

Note: Some issues require manual steps
HELP
    exit 0
fi

echo -e "${BOLD}🔧 SESSION AUTO-REPAIR${NC}"
echo "═══════════════════════════════════════════"
echo ""

# Determine repair mode
REPAIR_MODE="${ARGUMENTS:-auto}"
INTERACTIVE=false
FORCE_REPAIR=false

case "$REPAIR_MODE" in
    interactive|i)
        INTERACTIVE=true
        echo -e "${BLUE}ℹ️  Interactive mode - will ask before repairs${NC}\n"
        ;;
    force|f)
        FORCE_REPAIR=true
        echo -e "${YELLOW}⚠️  Force mode - will repair even if healthy${NC}\n"
        ;;
    auto|a|"")
        echo -e "${GREEN}✅ Auto mode - will fix all detected issues${NC}\n"
        ;;
    *)
        echo -e "${YELLOW}⚠️  Unknown mode: $REPAIR_MODE - using auto mode${NC}\n"
        ;;
esac

# Track repairs
REPAIRS_ATTEMPTED=0
REPAIRS_SUCCESSFUL=0
REPAIRS_FAILED=0
MANUAL_REQUIRED=()

# Helper functions
ask_confirmation() {
    if [ "$INTERACTIVE" = true ]; then
        echo -ne "${CYAN}Proceed with repair? [Y/n] ${NC}"
        read -r REPLY
        if [[ ! $REPLY =~ ^[Yy]$ ]] && [[ -n $REPLY ]]; then
            return 1
        fi
    fi
    return 0
}

log_repair() {
    local status=$1
    local message=$2
    
    case "$status" in
        success)
            echo -e "${GREEN}✅ Fixed: $message${NC}"
            ((REPAIRS_SUCCESSFUL++))
            ;;
        failed)
            echo -e "${RED}❌ Failed: $message${NC}"
            ((REPAIRS_FAILED++))
            ;;
        manual)
            echo -e "${YELLOW}⚠️  Manual: $message${NC}"
            MANUAL_REQUIRED+=("$message")
            ;;
        info)
            echo -e "${BLUE}ℹ️  $message${NC}"
            ;;
    esac
}

# Use Node.js repair system if available
if [ -f "./scripts/session-monitor.js" ] && command -v node &> /dev/null; then
    echo -e "${BLUE}ℹ️  Using advanced repair system${NC}\n"
    
    # Run auto-repair
    node ./scripts/session-monitor.js repair
    
    # Check exit code
    if [ $? -eq 0 ]; then
        echo -e "\n${GREEN}✅ All repairs completed successfully${NC}"
    else
        echo -e "\n${YELLOW}⚠️  Some repairs may require manual intervention${NC}"
    fi
    
    exit 0
fi

# Fallback to bash repair system
echo -e "${YELLOW}ℹ️  Using basic repair system (install Node.js for advanced repairs)${NC}\n"

echo -e "${BOLD}Scanning for issues...${NC}\n"

# 1. Check and repair directories
echo "🔍 Checking directory structure..."
REQUIRED_DIRS=(
    ".flowforge"
    ".flowforge/local"
    ".flowforge/logs"
    ".flowforge/logs/sessions"
    ".flowforge/state"
    ".flowforge/sessions"
    ".flowforge/data"
    "documentation/development"
)

for DIR in "${REQUIRED_DIRS[@]}"; do
    if [ ! -d "$DIR" ]; then
        ((REPAIRS_ATTEMPTED++))
        if ask_confirmation; then
            mkdir -p "$DIR"
            if [ -d "$DIR" ]; then
                log_repair "success" "Created directory: $DIR"
            else
                log_repair "failed" "Could not create: $DIR"
            fi
        else
            log_repair "info" "Skipped creating: $DIR"
        fi
    fi
done

# 2. Check and repair session file
echo -e "\n🔍 Checking session file..."
SESSION_FILE=".flowforge/local/session.json"
SESSION_NEEDS_REPAIR=false

if [ ! -f "$SESSION_FILE" ]; then
    SESSION_NEEDS_REPAIR=true
    log_repair "info" "Session file missing"
elif command -v jq &> /dev/null; then
    if ! jq empty "$SESSION_FILE" 2>/dev/null; then
        SESSION_NEEDS_REPAIR=true
        log_repair "info" "Session file corrupted"
        
        # Backup corrupted file
        cp "$SESSION_FILE" "${SESSION_FILE}.corrupt.$(date +%s)"
        log_repair "info" "Backed up corrupted file"
    fi
fi

if [ "$SESSION_NEEDS_REPAIR" = true ]; then
    ((REPAIRS_ATTEMPTED++))
    echo -e "${CYAN}Repairing session file...${NC}"
    
    if ask_confirmation; then
        # Try to extract task ID from git branch
        TASK_ID=""
        BRANCH=$(git branch --show-current 2>/dev/null || echo "")
        if [[ "$BRANCH" =~ ([0-9]+) ]]; then
            TASK_ID="${BASH_REMATCH[1]}"
        fi
        
        # Create new session file
        cat > "$SESSION_FILE" << EOF
{
  "sessionId": "repair-$(date +%s)-$$",
  "taskId": "$TASK_ID",
  "startTime": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "repaired": true,
  "repairedAt": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
}
EOF
        
        if [ -f "$SESSION_FILE" ]; then
            log_repair "success" "Session file created"
            if [ -n "$TASK_ID" ]; then
                log_repair "info" "Restored task ID: #$TASK_ID from branch"
            fi
        else
            log_repair "failed" "Could not create session file"
        fi
    else
        log_repair "info" "Skipped session file repair"
    fi
fi

# 3. Check and repair timer
echo -e "\n🔍 Checking time tracking..."
if [ -f "./scripts/task-time.sh" ]; then
    TIMER_STATUS=$(./scripts/task-time.sh status 2>&1 || echo "error")
    
    if echo "$TIMER_STATUS" | grep -q "No timer running"; then
        ((REPAIRS_ATTEMPTED++))
        log_repair "info" "Timer not running"
        
        if ask_confirmation; then
            # Get task ID from session or branch
            TASK_ID=""
            if [ -f "$SESSION_FILE" ] && command -v jq &> /dev/null; then
                TASK_ID=$(jq -r '.taskId // ""' "$SESSION_FILE" 2>/dev/null)
            fi
            
            if [ -z "$TASK_ID" ]; then
                BRANCH=$(git branch --show-current 2>/dev/null || echo "")
                if [[ "$BRANCH" =~ ([0-9]+) ]]; then
                    TASK_ID="${BASH_REMATCH[1]}"
                fi
            fi
            
            if [ -n "$TASK_ID" ]; then
                if ./scripts/task-time.sh start "$TASK_ID" 2>&1; then
                    log_repair "success" "Started timer for task #$TASK_ID"
                else
                    log_repair "failed" "Could not start timer"
                fi
            else
                log_repair "manual" "Cannot determine task ID - start timer manually"
            fi
        else
            log_repair "info" "Skipped timer repair"
        fi
    fi
else
    log_repair "info" "Time tracking script not found"
fi

# 4. Check and repair Git branch
echo -e "\n🔍 Checking Git branch..."
if git rev-parse --git-dir > /dev/null 2>&1; then
    CURRENT_BRANCH=$(git branch --show-current 2>/dev/null || echo "unknown")
    
    if [[ "$CURRENT_BRANCH" == "main" || "$CURRENT_BRANCH" == "develop" ]]; then
        ((REPAIRS_ATTEMPTED++))
        log_repair "info" "On protected branch: $CURRENT_BRANCH"
        
        if ask_confirmation; then
            # Get task ID for branch name
            TASK_ID=""
            if [ -f "$SESSION_FILE" ] && command -v jq &> /dev/null; then
                TASK_ID=$(jq -r '.taskId // ""' "$SESSION_FILE" 2>/dev/null)
            fi
            
            if [ -n "$TASK_ID" ]; then
                NEW_BRANCH="feature/${TASK_ID}-work"
                
                # Check for uncommitted changes
                if [ -n "$(git status --porcelain)" ]; then
                    log_repair "info" "Stashing uncommitted changes..."
                    git stash push -m "Auto-stash by repair at $(date)"
                    STASHED=true
                else
                    STASHED=false
                fi
                
                # Try to create/checkout branch
                if git show-ref --verify --quiet "refs/heads/$NEW_BRANCH"; then
                    git checkout "$NEW_BRANCH"
                    log_repair "success" "Switched to existing branch: $NEW_BRANCH"
                else
                    git checkout -b "$NEW_BRANCH"
                    log_repair "success" "Created and switched to: $NEW_BRANCH"
                fi
                
                # Restore stash if needed
                if [ "$STASHED" = true ]; then
                    git stash pop
                    log_repair "info" "Restored stashed changes"
                fi
            else
                log_repair "manual" "Create feature branch manually - no task ID found"
            fi
        else
            log_repair "info" "Skipped branch repair"
        fi
    fi
else
    log_repair "manual" "Not in git repository - run: git init"
fi

# 5. Handle uncommitted changes
echo -e "\n🔍 Checking for uncommitted changes..."
if command -v git &> /dev/null && git rev-parse --git-dir > /dev/null 2>&1; then
    CHANGES=$(git status --porcelain | wc -l)
    
    if [ "$CHANGES" -gt 20 ]; then
        ((REPAIRS_ATTEMPTED++))
        log_repair "info" "$CHANGES uncommitted changes found"
        
        echo -e "${CYAN}Would you like to:${NC}"
        echo "  1) Create WIP commit"
        echo "  2) Stash changes"
        echo "  3) Skip"
        echo -ne "${CYAN}Choice [1/2/3]: ${NC}"
        read -r CHOICE
        
        case "$CHOICE" in
            1)
                git add .
                git commit -m "WIP: Auto-commit by repair at $(date)"
                log_repair "success" "Created WIP commit for $CHANGES files"
                ;;
            2)
                git stash push -m "Auto-stash by repair at $(date)"
                log_repair "success" "Stashed $CHANGES changes"
                ;;
            *)
                log_repair "info" "Skipped handling uncommitted changes"
                ;;
        esac
    fi
fi

# 6. Check provider system
echo -e "\n🔍 Checking provider system..."
PROVIDER_FOUND=false
for PROVIDER_FILE in "./scripts/provider-bridge.js" "./dist/scripts/provider-bridge.js"; do
    if [ -f "$PROVIDER_FILE" ]; then
        PROVIDER_FOUND=true
        break
    fi
done

if [ "$PROVIDER_FOUND" = false ]; then
    log_repair "info" "Provider bridge not found"
    
    # Check if we can install it
    if [ -f "package.json" ] && command -v npm &> /dev/null; then
        ((REPAIRS_ATTEMPTED++))
        
        if ask_confirmation; then
            echo -e "${CYAN}Installing dependencies...${NC}"
            if npm install 2>&1; then
                log_repair "success" "Dependencies installed"
            else
                log_repair "failed" "Could not install dependencies"
            fi
        else
            log_repair "info" "Skipped dependency installation"
        fi
    fi
fi

# 7. Check GitHub CLI
echo -e "\n🔍 Checking GitHub CLI..."
if command -v gh &> /dev/null; then
    if ! gh auth status &> /dev/null; then
        log_repair "manual" "GitHub CLI not authenticated - run: gh auth login"
    fi
else
    log_repair "manual" "GitHub CLI not installed - get from: https://cli.github.com"
fi

# 8. Clean up old logs and snapshots
echo -e "\n🔍 Cleaning up old files..."
if [ -d ".flowforge/logs/sessions" ]; then
    OLD_LOGS=$(find .flowforge/logs/sessions -name "*.log" -mtime +7 2>/dev/null | wc -l)
    if [ "$OLD_LOGS" -gt 0 ]; then
        ((REPAIRS_ATTEMPTED++))
        
        if ask_confirmation; then
            find .flowforge/logs/sessions -name "*.log" -mtime +7 -delete
            log_repair "success" "Cleaned up $OLD_LOGS old log files"
        else
            log_repair "info" "Skipped log cleanup"
        fi
    fi
fi

if [ -d ".flowforge/state" ]; then
    OLD_SNAPSHOTS=$(find .flowforge/state -name "snapshot-*.json" -mtime +3 2>/dev/null | wc -l)
    if [ "$OLD_SNAPSHOTS" -gt 0 ]; then
        ((REPAIRS_ATTEMPTED++))
        
        if ask_confirmation; then
            find .flowforge/state -name "snapshot-*.json" -mtime +3 -delete
            log_repair "success" "Cleaned up $OLD_SNAPSHOTS old snapshots"
        else
            log_repair "info" "Skipped snapshot cleanup"
        fi
    fi
fi

# 9. Validate FlowForge installation
echo -e "\n🔍 Validating FlowForge installation..."
MISSING_SCRIPTS=()
CRITICAL_SCRIPTS=(
    "scripts/task-time.sh"
    "scripts/provider-bridge.js"
    "scripts/session-monitor.js"
)

for SCRIPT in "${CRITICAL_SCRIPTS[@]}"; do
    if [ ! -f "$SCRIPT" ]; then
        MISSING_SCRIPTS+=("$SCRIPT")
    fi
done

if [ ${#MISSING_SCRIPTS[@]} -gt 0 ]; then
    log_repair "manual" "Missing scripts: ${MISSING_SCRIPTS[*]}"
    log_repair "info" "Run: /flowforge:version:update to restore missing files"
fi

# Summary
echo -e "\n═══════════════════════════════════════════"
echo -e "${BOLD}Repair Summary:${NC}"
echo "═══════════════════════════════════════════"

if [ "$REPAIRS_ATTEMPTED" -eq 0 ]; then
    echo -e "${GREEN}✅ No issues found - session is healthy!${NC}"
else
    echo -e "Repairs attempted: $REPAIRS_ATTEMPTED"
    echo -e "  ${GREEN}✅ Successful: $REPAIRS_SUCCESSFUL${NC}"
    
    if [ "$REPAIRS_FAILED" -gt 0 ]; then
        echo -e "  ${RED}❌ Failed: $REPAIRS_FAILED${NC}"
    fi
    
    if [ ${#MANUAL_REQUIRED[@]} -gt 0 ]; then
        echo -e "\n${BOLD}Manual actions required:${NC}"
        for ACTION in "${MANUAL_REQUIRED[@]}"; do
            echo -e "  ${YELLOW}• $ACTION${NC}"
        done
    fi
fi

echo "═══════════════════════════════════════════"

# Run health check to verify
echo -e "\n${BLUE}Running health check to verify repairs...${NC}\n"

# Simple health check
HEALTH_GOOD=true

# Quick checks
[ -f "$SESSION_FILE" ] || HEALTH_GOOD=false
[ -d ".flowforge/logs" ] || HEALTH_GOOD=false
git rev-parse --git-dir > /dev/null 2>&1 || HEALTH_GOOD=false

if [ "$HEALTH_GOOD" = true ]; then
    echo -e "${GREEN}✅ Session health: GOOD${NC}"
    echo -e "${CYAN}💡 Run '/flowforge:session:health' for detailed status${NC}"
    exit 0
else
    echo -e "${YELLOW}⚠️  Session health: NEEDS ATTENTION${NC}"
    echo -e "${CYAN}💡 Run '/flowforge:session:health verbose' for details${NC}"
    exit 1
fi
```

## 🎯 Repair Complete!
The auto-repair process has finished. Check the summary above for any manual actions required.