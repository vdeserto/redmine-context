# Command: flowforge:session:health
# Version: 2.0.0
# Description: Check session health and diagnose issues

---
description: Comprehensive health check for FlowForge session with diagnostics
argument-hint: "[verbose]"
---

# 🏥 Session Health Check

## 📋 Running Comprehensive Health Diagnostics
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
🏥 FlowForge Session Health Check

Usage: /flowforge:session:health [verbose]

What it does:
✓ Checks all session components
✓ Validates configuration
✓ Identifies issues with solutions
✓ Monitors system resources
✓ Verifies time tracking

Options:
  verbose    Show detailed diagnostics
  ?/help     Show this help

Components checked:
• Git repository and branch
• Session file integrity
• Time tracking status
• Provider system
• GitHub CLI
• Directory structure
• Uncommitted changes

Error codes identified:
• SESSION_001: Session file issues
• SESSION_002: Timer problems
• SESSION_003: Branch issues
• GIT_001: Repository problems
• GIT_002: Uncommitted changes
• PROVIDER_001: Provider system
• GITHUB_001: GitHub CLI issues

After health check:
- Green items are healthy
- Yellow items need attention
- Red items require repair

Run '/flowforge:session:repair' to fix issues
HELP
    exit 0
fi

echo -e "${BOLD}🏥 SESSION HEALTH CHECK${NC}"
echo "═══════════════════════════════════════════"
echo ""

# Verbose mode flag
VERBOSE_MODE=false
if [[ "${ARGUMENTS:-}" == "verbose" || "${ARGUMENTS:-}" == "v" || "${DEBUG:-0}" == "1" ]]; then
    VERBOSE_MODE=true
    echo -e "${GRAY}Debug mode: ENABLED${NC}\n"
fi

# Track overall health
OVERALL_STATUS="healthy"
ISSUES_FOUND=()
WARNINGS_FOUND=()

# Helper function for logging
log_verbose() {
    if [ "$VERBOSE_MODE" = true ]; then
        echo -e "${GRAY}  [DEBUG] $1${NC}"
    fi
}

# Use Node.js monitor if available
if [ -f "./scripts/session-monitor.js" ] && command -v node &> /dev/null; then
    log_verbose "Using advanced Node.js monitor"
    
    # Run comprehensive health check
    node ./scripts/session-monitor.js health
    
    # Check exit code
    if [ $? -eq 0 ]; then
        echo -e "\n${GREEN}✅ Session is healthy${NC}"
    else
        echo -e "\n${YELLOW}⚠️  Issues detected - run '/flowforge:session:repair' to fix${NC}"
    fi
    
    exit 0
fi

# Fallback to bash health checks
echo -e "${YELLOW}ℹ️  Using basic health check (install Node.js for advanced diagnostics)${NC}\n"

echo -e "${BOLD}Component Checks:${NC}"

# 1. Git Repository Check
echo -n "  "
if git rev-parse --git-dir > /dev/null 2>&1; then
    echo -e "✅ Git Repository: ${GREEN}Found${NC}"
    log_verbose "Git directory: $(git rev-parse --git-dir)"
else
    echo -e "❌ Git Repository: ${RED}Not found${NC}"
    echo -e "     ${CYAN}💡 Run: git init${NC}"
    ISSUES_FOUND+=("GIT_001: Not in git repository")
    OVERALL_STATUS="unhealthy"
fi

# 2. Git Branch Check
echo -n "  "
CURRENT_BRANCH=$(git branch --show-current 2>/dev/null || echo "unknown")
if [[ "$CURRENT_BRANCH" == "main" || "$CURRENT_BRANCH" == "develop" ]]; then
    echo -e "⚠️  Git Branch: ${YELLOW}On protected branch ($CURRENT_BRANCH)${NC}"
    echo -e "     ${CYAN}💡 Create feature branch: git checkout -b feature/XXX-work${NC}"
    WARNINGS_FOUND+=("SESSION_003: On protected branch")
    if [ "$OVERALL_STATUS" = "healthy" ]; then
        OVERALL_STATUS="degraded"
    fi
elif [ "$CURRENT_BRANCH" = "unknown" ]; then
    echo -e "❌ Git Branch: ${RED}Cannot determine${NC}"
    ISSUES_FOUND+=("GIT_001: Cannot determine branch")
    OVERALL_STATUS="unhealthy"
else
    echo -e "✅ Git Branch: ${GREEN}$CURRENT_BRANCH${NC}"
    log_verbose "Current branch: $CURRENT_BRANCH"
fi

# 3. Session File Check
echo -n "  "
SESSION_FILE=".flowforge/local/session.json"
if [ -f "$SESSION_FILE" ]; then
    if command -v jq &> /dev/null; then
        if jq empty "$SESSION_FILE" 2>/dev/null; then
            TASK_ID=$(jq -r '.taskId // "none"' "$SESSION_FILE" 2>/dev/null || echo "none")
            if [ "$TASK_ID" != "none" ]; then
                echo -e "✅ Session File: ${GREEN}Valid (Task #$TASK_ID)${NC}"
                log_verbose "Session ID: $(jq -r '.sessionId // "unknown"' "$SESSION_FILE")"
            else
                echo -e "⚠️  Session File: ${YELLOW}No active task${NC}"
                WARNINGS_FOUND+=("SESSION_001: No task in session")
            fi
        else
            echo -e "❌ Session File: ${RED}Corrupted JSON${NC}"
            echo -e "     ${CYAN}💡 Run: /flowforge:session:repair${NC}"
            ISSUES_FOUND+=("SESSION_001: Corrupted session file")
            OVERALL_STATUS="unhealthy"
        fi
    else
        echo -e "⚠️  Session File: ${YELLOW}Cannot validate (jq not installed)${NC}"
        log_verbose "Install jq for JSON validation"
    fi
else
    echo -e "❌ Session File: ${RED}Not found${NC}"
    echo -e "     ${CYAN}💡 Run: /flowforge:session:start [issue]${NC}"
    ISSUES_FOUND+=("SESSION_001: Session file missing")
    OVERALL_STATUS="unhealthy"
fi

# 4. Time Tracking Check
echo -n "  "
if [ -f "./scripts/task-time.sh" ]; then
    TIMER_STATUS=$(./scripts/task-time.sh status 2>&1 || echo "error")
    if echo "$TIMER_STATUS" | grep -q "No timer running"; then
        echo -e "⚠️  Time Tracking: ${YELLOW}Timer not running${NC}"
        echo -e "     ${CYAN}💡 Start timer: ./scripts/task-time.sh start [issue]${NC}"
        WARNINGS_FOUND+=("SESSION_002: Timer not running")
        if [ "$OVERALL_STATUS" = "healthy" ]; then
            OVERALL_STATUS="degraded"
        fi
    elif echo "$TIMER_STATUS" | grep -q "error"; then
        echo -e "❌ Time Tracking: ${RED}Error checking timer${NC}"
        ISSUES_FOUND+=("SESSION_002: Timer error")
    else
        echo -e "✅ Time Tracking: ${GREEN}Active${NC}"
        log_verbose "Timer output: $(echo "$TIMER_STATUS" | head -1)"
    fi
else
    echo -e "⚠️  Time Tracking: ${YELLOW}Script not found${NC}"
    WARNINGS_FOUND+=("SESSION_002: Time tracking unavailable")
fi

# 5. Provider System Check
echo -n "  "
PROVIDER_FOUND=false
for PROVIDER_FILE in "./scripts/provider-bridge.js" "./dist/scripts/provider-bridge.js"; do
    if [ -f "$PROVIDER_FILE" ]; then
        PROVIDER_FOUND=true
        break
    fi
done

if [ "$PROVIDER_FOUND" = true ]; then
    if command -v node &> /dev/null; then
        echo -e "✅ Provider System: ${GREEN}Available${NC}"
        log_verbose "Provider at: $PROVIDER_FILE"
    else
        echo -e "⚠️  Provider System: ${YELLOW}Node.js not found${NC}"
        echo -e "     ${CYAN}💡 Install Node.js: https://nodejs.org${NC}"
        WARNINGS_FOUND+=("PROVIDER_001: Node.js missing")
    fi
else
    echo -e "⚠️  Provider System: ${YELLOW}Bridge not found${NC}"
    WARNINGS_FOUND+=("PROVIDER_001: Provider bridge missing")
fi

# 6. GitHub CLI Check
echo -n "  "
if command -v gh &> /dev/null; then
    if gh auth status &> /dev/null; then
        echo -e "✅ GitHub CLI: ${GREEN}Authenticated${NC}"
        log_verbose "GitHub user: $(gh api user -q .login 2>/dev/null || echo 'unknown')"
    else
        echo -e "⚠️  GitHub CLI: ${YELLOW}Not authenticated${NC}"
        echo -e "     ${CYAN}💡 Run: gh auth login${NC}"
        WARNINGS_FOUND+=("GITHUB_001: Not authenticated")
    fi
else
    echo -e "⚠️  GitHub CLI: ${YELLOW}Not installed${NC}"
    echo -e "     ${CYAN}💡 Install from: https://cli.github.com${NC}"
    WARNINGS_FOUND+=("GITHUB_001: GitHub CLI missing")
fi

# 7. Directory Structure Check
echo -n "  "
REQUIRED_DIRS=(".flowforge" ".flowforge/local" ".flowforge/logs" "scripts" "commands")
MISSING_DIRS=()
for DIR in "${REQUIRED_DIRS[@]}"; do
    if [ ! -d "$DIR" ]; then
        MISSING_DIRS+=("$DIR")
    fi
done

if [ ${#MISSING_DIRS[@]} -eq 0 ]; then
    echo -e "✅ Directory Structure: ${GREEN}Complete${NC}"
    log_verbose "All required directories present"
else
    echo -e "⚠️  Directory Structure: ${YELLOW}Missing: ${MISSING_DIRS[*]}${NC}"
    echo -e "     ${CYAN}💡 Run: mkdir -p ${MISSING_DIRS[*]}${NC}"
    WARNINGS_FOUND+=("Missing directories")
fi

# 8. Uncommitted Changes Check
echo -n "  "
if command -v git &> /dev/null; then
    CHANGES=$(git status --porcelain 2>/dev/null | wc -l)
    if [ "$CHANGES" -gt 10 ]; then
        echo -e "⚠️  Git Status: ${YELLOW}$CHANGES uncommitted changes${NC}"
        echo -e "     ${CYAN}💡 Commit changes: git add . && git commit -m 'WIP'${NC}"
        WARNINGS_FOUND+=("GIT_002: Many uncommitted changes")
    elif [ "$CHANGES" -gt 0 ]; then
        echo -e "ℹ️  Git Status: ${BLUE}$CHANGES uncommitted changes${NC}"
    else
        echo -e "✅ Git Status: ${GREEN}Working directory clean${NC}"
    fi
fi

# 9. Real-time Tracking Check (if available)
echo -n "  "
if [ -f "./scripts/realtime-tracker.js" ] && command -v node &> /dev/null; then
    REALTIME_STATUS=$(node ./scripts/realtime-tracker.js status 2>&1 || echo "not running")
    if echo "$REALTIME_STATUS" | grep -q "active"; then
        echo -e "✅ Real-time Tracking: ${GREEN}Active${NC}"
    else
        echo -e "ℹ️  Real-time Tracking: ${BLUE}Not active${NC}"
    fi
else
    log_verbose "Real-time tracking not available"
fi

# 10. Resource Usage Check
echo -e "\n${BOLD}System Resources:${NC}"

# Disk space
DISK_USAGE=$(df -h . | awk 'NR==2 {print $5}' | sed 's/%//')
echo -n "  "
if [ "$DISK_USAGE" -gt 90 ]; then
    echo -e "❌ Disk Space: ${RED}${DISK_USAGE}% used${NC}"
    ISSUES_FOUND+=("Low disk space")
    OVERALL_STATUS="unhealthy"
elif [ "$DISK_USAGE" -gt 80 ]; then
    echo -e "⚠️  Disk Space: ${YELLOW}${DISK_USAGE}% used${NC}"
    WARNINGS_FOUND+=("Disk usage high")
else
    echo -e "✅ Disk Space: ${GREEN}${DISK_USAGE}% used${NC}"
fi

# Memory (if available)
if command -v free &> /dev/null; then
    MEM_USAGE=$(free | grep Mem | awk '{printf "%.0f", $3/$2 * 100}')
    echo -n "  "
    if [ "$MEM_USAGE" -gt 90 ]; then
        echo -e "⚠️  Memory: ${YELLOW}${MEM_USAGE}% used${NC}"
    else
        echo -e "✅ Memory: ${GREEN}${MEM_USAGE}% used${NC}"
    fi
fi

# Log file sizes
LOG_SIZE=$(du -sh .flowforge/logs 2>/dev/null | cut -f1 || echo "0")
echo -e "  ℹ️  Log Files: ${BLUE}$LOG_SIZE${NC}"

# Summary
echo -e "\n═══════════════════════════════════════════"
echo -e "${BOLD}Overall Status:${NC} "

if [ "$OVERALL_STATUS" = "healthy" ]; then
    echo -e "${GREEN}✅ HEALTHY - All systems operational${NC}"
elif [ "$OVERALL_STATUS" = "degraded" ]; then
    echo -e "${YELLOW}⚠️  DEGRADED - Some issues need attention${NC}"
    
    if [ ${#WARNINGS_FOUND[@]} -gt 0 ]; then
        echo -e "\n${BOLD}Warnings (${#WARNINGS_FOUND[@]}):${NC}"
        for WARNING in "${WARNINGS_FOUND[@]}"; do
            echo -e "  • $WARNING"
        done
    fi
    
    echo -e "\n${CYAN}💊 Run '/flowforge:session:repair' to attempt fixes${NC}"
else
    echo -e "${RED}❌ UNHEALTHY - Critical issues detected${NC}"
    
    if [ ${#ISSUES_FOUND[@]} -gt 0 ]; then
        echo -e "\n${BOLD}Critical Issues (${#ISSUES_FOUND[@]}):${NC}"
        for ISSUE in "${ISSUES_FOUND[@]}"; do
            echo -e "  • $ISSUE"
        done
    fi
    
    if [ ${#WARNINGS_FOUND[@]} -gt 0 ]; then
        echo -e "\n${BOLD}Warnings (${#WARNINGS_FOUND[@]}):${NC}"
        for WARNING in "${WARNINGS_FOUND[@]}"; do
            echo -e "  • $WARNING"
        done
    fi
    
    echo -e "\n${RED}🔧 Run '/flowforge:session:repair' to fix issues${NC}"
fi

echo "═══════════════════════════════════════════"

# Verbose diagnostics
if [ "$VERBOSE_MODE" = true ]; then
    echo -e "\n${BOLD}Detailed Diagnostics:${NC}"
    echo -e "${GRAY}Timestamp: $(date -u +"%Y-%m-%dT%H:%M:%SZ")${NC}"
    echo -e "${GRAY}User: ${USER:-unknown}${NC}"
    echo -e "${GRAY}Working Dir: $(pwd)${NC}"
    echo -e "${GRAY}Shell: ${SHELL:-unknown}${NC}"
    echo -e "${GRAY}PATH entries: $(echo "$PATH" | tr ':' '\n' | wc -l)${NC}"
    
    if [ -f "$SESSION_FILE" ] && command -v jq &> /dev/null; then
        echo -e "\n${BOLD}Session Data:${NC}"
        jq . "$SESSION_FILE" 2>/dev/null | head -20 || echo "  (unable to parse)"
    fi
    
    echo -e "\n${BOLD}Recent Logs:${NC}"
    if [ -d ".flowforge/logs/sessions" ]; then
        LATEST_LOG=$(ls -t .flowforge/logs/sessions/*.log 2>/dev/null | head -1)
        if [ -n "$LATEST_LOG" ]; then
            echo -e "${GRAY}From: $LATEST_LOG${NC}"
            tail -5 "$LATEST_LOG" 2>/dev/null | while IFS= read -r line; do
                echo -e "${GRAY}  $line${NC}"
            done
        else
            echo -e "${GRAY}  No session logs found${NC}"
        fi
    fi
fi

# Exit with appropriate code
if [ "$OVERALL_STATUS" = "healthy" ]; then
    exit 0
elif [ "$OVERALL_STATUS" = "degraded" ]; then
    exit 1
else
    exit 2
fi
```

## 🎯 Health Check Complete!
The session health status has been evaluated. Follow the suggestions above to resolve any issues detected.