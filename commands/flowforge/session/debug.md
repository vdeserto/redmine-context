# Command: flowforge:session:debug
# Version: 2.0.0
# Description: Enable debug mode with detailed diagnostics

---
description: Enable debug mode for FlowForge sessions with comprehensive diagnostics
argument-hint: "[logs|state|all]"
---

# 🔍 Session Debug Mode

## 📋 Enabling Deep Diagnostics
```bash
set -euo pipefail

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
GRAY='\033[0;90m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# Check for help request
if [[ "${ARGUMENTS:-}" == "?" || "${ARGUMENTS:-}" == "help" ]]; then
    cat << 'HELP'
🔍 FlowForge Session Debug Mode

Usage: /flowforge:session:debug [option]

What it does:
✓ Enables detailed logging
✓ Shows all state snapshots
✓ Displays recent logs
✓ Traces operation flow
✓ Monitors file changes

Options:
  logs       Show recent log entries
  state      Display session state
  trace      Enable operation tracing
  monitor    Real-time monitoring
  all        Show everything (default)
  off        Disable debug mode
  ?/help     Show this help

Debug features:
• Structured JSON logs
• Operation snapshots
• Performance metrics
• Error tracking
• State transitions

Files monitored:
• .flowforge/logs/sessions/*.log
• .flowforge/state/*.json
• .flowforge/local/session.json

After enabling:
- All commands show verbose output
- Operations are traced
- Errors include stack traces
- Performance is measured
HELP
    exit 0
fi

echo -e "${BOLD}🔍 SESSION DEBUG MODE${NC}"
echo "═══════════════════════════════════════════"
echo ""

# Get debug option
DEBUG_OPTION="${ARGUMENTS:-all}"

# Enable debug environment
export DEBUG=1
export FLOWFORGE_DEBUG=1
export VERBOSE=1

echo -e "${GREEN}✅ Debug environment enabled${NC}"
echo -e "${GRAY}  DEBUG=1${NC}"
echo -e "${GRAY}  FLOWFORGE_DEBUG=1${NC}"
echo -e "${GRAY}  VERBOSE=1${NC}"
echo ""

# Helper function to display JSON nicely
show_json() {
    local file=$1
    local title=$2
    
    if [ -f "$file" ]; then
        echo -e "${BOLD}$title:${NC}"
        if command -v jq &> /dev/null; then
            jq . "$file" 2>/dev/null | head -50 || cat "$file" | head -50
        else
            cat "$file" | head -50
        fi
        echo ""
    fi
}

# Helper to show file with line numbers
show_file_excerpt() {
    local file=$1
    local lines=${2:-10}
    local title=${3:-"File"}
    
    if [ -f "$file" ]; then
        echo -e "${BOLD}$title: ${GRAY}$file${NC}"
        nl -ba "$file" | tail -"$lines"
        echo ""
    fi
}

case "$DEBUG_OPTION" in
    off|disable)
        unset DEBUG
        unset FLOWFORGE_DEBUG
        unset VERBOSE
        echo -e "${YELLOW}Debug mode disabled${NC}"
        echo -e "${GRAY}Environment variables cleared${NC}"
        exit 0
        ;;
        
    logs|log)
        echo -e "${BOLD}📋 Recent Session Logs${NC}"
        echo "─────────────────────────────────────"
        
        if [ -f "./scripts/session-monitor.js" ] && command -v node &> /dev/null; then
            node ./scripts/session-monitor.js logs 100
        else
            # Fallback to basic log display
            LOG_DIR=".flowforge/logs/sessions"
            if [ -d "$LOG_DIR" ]; then
                LATEST_LOG=$(ls -t "$LOG_DIR"/*.log 2>/dev/null | head -1)
                if [ -n "$LATEST_LOG" ]; then
                    echo -e "${GRAY}Log file: $LATEST_LOG${NC}\n"
                    
                    if command -v jq &> /dev/null && [[ "$LATEST_LOG" == *.json* ]]; then
                        # JSON logs
                        tail -20 "$LATEST_LOG" | while IFS= read -r line; do
                            if [ -n "$line" ]; then
                                echo "$line" | jq -r '"\(.timestamp) [\(.level)] \(.message)"' 2>/dev/null || echo "$line"
                            fi
                        done
                    else
                        # Plain text logs
                        tail -50 "$LATEST_LOG"
                    fi
                else
                    echo -e "${YELLOW}No session logs found${NC}"
                fi
            else
                echo -e "${YELLOW}Log directory not found${NC}"
            fi
        fi
        ;;
        
    state)
        echo -e "${BOLD}📊 Current Session State${NC}"
        echo "─────────────────────────────────────"
        
        # Show session file
        show_json ".flowforge/local/session.json" "Session Data"
        
        # Show state file
        show_json ".flowforge/state/session-state.json" "State Manager"
        
        # Show latest snapshot
        if [ -d ".flowforge/state" ]; then
            LATEST_SNAPSHOT=$(ls -t .flowforge/state/snapshot-*.json 2>/dev/null | head -1)
            if [ -n "$LATEST_SNAPSHOT" ]; then
                show_json "$LATEST_SNAPSHOT" "Latest Snapshot"
            fi
        fi
        
        # Show timer state
        if [ -f "./scripts/task-time.sh" ]; then
            echo -e "${BOLD}Timer Status:${NC}"
            ./scripts/task-time.sh status 2>&1 | head -10 || echo "  No timer data"
            echo ""
        fi
        ;;
        
    trace)
        echo -e "${BOLD}🔬 Operation Tracing Enabled${NC}"
        echo "─────────────────────────────────────"
        
        # Create trace file
        TRACE_FILE=".flowforge/logs/trace-$(date +%s).log"
        touch "$TRACE_FILE"
        
        echo -e "${GREEN}✅ Tracing to: $TRACE_FILE${NC}"
        echo -e "${GRAY}All operations will be logged with timestamps${NC}\n"
        
        # Set bash tracing
        export PS4='+ $(date "+%H:%M:%S.%N") [${BASH_SOURCE}:${LINENO}]: '
        set -x
        
        echo -e "${CYAN}Bash tracing enabled (set -x)${NC}"
        echo -e "${YELLOW}Run any command to see detailed trace${NC}"
        ;;
        
    monitor)
        echo -e "${BOLD}📡 Real-time Monitoring${NC}"
        echo "─────────────────────────────────────"
        
        if [ -f "./scripts/session-monitor.js" ] && command -v node &> /dev/null; then
            echo -e "${GREEN}Starting monitor...${NC}"
            echo -e "${GRAY}Press Ctrl+C to stop${NC}\n"
            
            # Start monitoring in background
            node ./scripts/session-monitor.js monitor "real-time" '{"mode":"watch"}' &
            MONITOR_PID=$!
            
            echo -e "${CYAN}Monitor PID: $MONITOR_PID${NC}"
            echo -e "${YELLOW}Watching for changes...${NC}\n"
            
            # Watch key files
            if command -v inotifywait &> /dev/null; then
                inotifywait -m -r \
                    -e modify,create,delete \
                    .flowforge/local/session.json \
                    .flowforge/logs/ \
                    .flowforge/state/ \
                    2>/dev/null | while read path action file; do
                    echo -e "${GRAY}[$(date +%H:%M:%S)] ${CYAN}$action${NC}: $path$file"
                done
            else
                echo -e "${YELLOW}Install inotify-tools for file watching${NC}"
                echo -e "${GRAY}Showing log tail instead...${NC}\n"
                
                tail -f .flowforge/logs/sessions/*.log 2>/dev/null || \
                tail -f .flowforge/logs/*.log 2>/dev/null || \
                echo "No logs to monitor"
            fi
        else
            echo -e "${YELLOW}Advanced monitoring requires Node.js${NC}"
        fi
        ;;
        
    all|*)
        echo -e "${BOLD}🔬 COMPREHENSIVE DEBUG INFORMATION${NC}"
        echo "═══════════════════════════════════════════\n"
        
        # 1. Environment Information
        echo -e "${BOLD}Environment:${NC}"
        echo -e "  ${GRAY}User:${NC} ${USER:-unknown}"
        echo -e "  ${GRAY}Shell:${NC} ${SHELL:-unknown}"
        echo -e "  ${GRAY}PWD:${NC} $(pwd)"
        echo -e "  ${GRAY}Node:${NC} $(node --version 2>/dev/null || echo 'not installed')"
        echo -e "  ${GRAY}Git:${NC} $(git --version 2>/dev/null | cut -d' ' -f3 || echo 'not installed')"
        echo -e "  ${GRAY}Time:${NC} $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
        echo ""
        
        # 2. Git Information
        echo -e "${BOLD}Git Status:${NC}"
        if git rev-parse --git-dir > /dev/null 2>&1; then
            echo -e "  ${GRAY}Branch:${NC} $(git branch --show-current)"
            echo -e "  ${GRAY}Remote:${NC} $(git remote -v | head -1 | awk '{print $2}' || echo 'none')"
            echo -e "  ${GRAY}Last Commit:${NC} $(git log -1 --format='%h %s' 2>/dev/null || echo 'none')"
            echo -e "  ${GRAY}Changes:${NC} $(git status --porcelain | wc -l) files"
            
            # Show recent commits
            echo -e "\n  ${BOLD}Recent Commits:${NC}"
            git log --oneline -5 2>/dev/null | sed 's/^/    /'
        else
            echo -e "  ${RED}Not a git repository${NC}"
        fi
        echo ""
        
        # 3. Session Information
        echo -e "${BOLD}Session Data:${NC}"
        SESSION_FILE=".flowforge/local/session.json"
        if [ -f "$SESSION_FILE" ]; then
            if command -v jq &> /dev/null; then
                jq . "$SESSION_FILE" | sed 's/^/  /'
            else
                cat "$SESSION_FILE" | sed 's/^/  /'
            fi
        else
            echo -e "  ${YELLOW}No active session${NC}"
        fi
        echo ""
        
        # 4. Directory Structure
        echo -e "${BOLD}FlowForge Structure:${NC}"
        if command -v tree &> /dev/null; then
            tree -L 2 .flowforge 2>/dev/null | head -20
        else
            find .flowforge -type d -maxdepth 2 2>/dev/null | sort | sed 's/^/  /'
        fi
        echo ""
        
        # 5. Recent Errors
        echo -e "${BOLD}Recent Errors:${NC}"
        if [ -d ".flowforge/logs" ]; then
            grep -r "ERROR\|error\|Error" .flowforge/logs --include="*.log" 2>/dev/null | tail -5 | while IFS= read -r line; do
                echo -e "  ${RED}•${NC} ${line:0:100}..."
            done || echo -e "  ${GREEN}No recent errors${NC}"
        fi
        echo ""
        
        # 6. Process Information
        echo -e "${BOLD}Active Processes:${NC}"
        # Check for FlowForge-related processes
        ps aux | grep -E "flowforge|task-time|provider-bridge|realtime-tracker" | grep -v grep | head -5 | while IFS= read -r line; do
            PID=$(echo "$line" | awk '{print $2}')
            CMD=$(echo "$line" | awk '{for(i=11;i<=NF;i++) printf "%s ", $i; print ""}')
            echo -e "  ${GRAY}PID $PID:${NC} ${CMD:0:60}..."
        done || echo -e "  ${GRAY}No FlowForge processes running${NC}"
        echo ""
        
        # 7. File Sizes
        echo -e "${BOLD}Storage Usage:${NC}"
        echo -e "  ${GRAY}Logs:${NC} $(du -sh .flowforge/logs 2>/dev/null | cut -f1 || echo '0')"
        echo -e "  ${GRAY}State:${NC} $(du -sh .flowforge/state 2>/dev/null | cut -f1 || echo '0')"
        echo -e "  ${GRAY}Sessions:${NC} $(du -sh .flowforge/sessions 2>/dev/null | cut -f1 || echo '0')"
        echo -e "  ${GRAY}Total .flowforge:${NC} $(du -sh .flowforge 2>/dev/null | cut -f1 || echo '0')"
        echo ""
        
        # 8. Recent Log Entries
        echo -e "${BOLD}Recent Log Entries:${NC}"
        LOG_DIR=".flowforge/logs/sessions"
        if [ -d "$LOG_DIR" ]; then
            LATEST_LOG=$(ls -t "$LOG_DIR"/*.log 2>/dev/null | head -1)
            if [ -n "$LATEST_LOG" ]; then
                echo -e "  ${GRAY}From: $LATEST_LOG${NC}"
                tail -10 "$LATEST_LOG" | sed 's/^/  /'
            fi
        else
            echo -e "  ${GRAY}No session logs${NC}"
        fi
        echo ""
        
        # 9. Performance Metrics
        echo -e "${BOLD}Performance Metrics:${NC}"
        echo -e "  ${GRAY}Load Average:${NC} $(uptime | awk -F'load average:' '{print $2}')"
        echo -e "  ${GRAY}Memory:${NC} $(free -h 2>/dev/null | grep Mem | awk '{print "Used: "$3" / "$2}' || echo 'N/A')"
        echo -e "  ${GRAY}Disk:${NC} $(df -h . | awk 'NR==2 {print "Used: "$3" / "$2" ("$5")"}')"
        echo ""
        
        # 10. Configuration Files
        echo -e "${BOLD}Configuration:${NC}"
        CONFIG_FILES=(
            ".flowforge/config.json"
            ".flowforge/local/settings.json"
            ".flowforge/preferences.json"
        )
        
        for CONFIG in "${CONFIG_FILES[@]}"; do
            if [ -f "$CONFIG" ]; then
                echo -e "  ${GREEN}✓${NC} $CONFIG"
            else
                echo -e "  ${GRAY}✗${NC} $CONFIG (not found)"
            fi
        done
        echo ""
        
        # 11. Hook Status
        echo -e "${BOLD}Git Hooks:${NC}"
        if [ -d ".git/hooks" ]; then
            for HOOK in pre-commit post-commit pre-push; do
                if [ -f ".git/hooks/$HOOK" ]; then
                    echo -e "  ${GREEN}✓${NC} $HOOK ($(wc -l < .git/hooks/$HOOK) lines)"
                else
                    echo -e "  ${GRAY}✗${NC} $HOOK"
                fi
            done
        else
            echo -e "  ${YELLOW}No .git/hooks directory${NC}"
        fi
        echo ""
        
        # 12. Enable continuous debug
        echo "═══════════════════════════════════════════"
        echo -e "${GREEN}✅ Debug mode is now active${NC}"
        echo -e "${CYAN}All subsequent commands will show verbose output${NC}"
        echo -e "${YELLOW}To disable: /flowforge:session:debug off${NC}"
        ;;
esac

# Save debug state
if [ "$DEBUG_OPTION" != "off" ]; then
    DEBUG_STATE_FILE=".flowforge/state/debug.state"
    mkdir -p .flowforge/state
    cat > "$DEBUG_STATE_FILE" << EOF
{
  "enabled": true,
  "enabledAt": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "mode": "$DEBUG_OPTION",
  "user": "${USER:-unknown}",
  "pid": $$
}
EOF
    
    echo -e "\n${GRAY}Debug state saved to: $DEBUG_STATE_FILE${NC}"
fi

echo ""
exit 0
```

## 🎯 Debug Mode Active!
Detailed diagnostics and verbose logging are now enabled for all FlowForge operations.