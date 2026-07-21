#!/bin/bash
# FlowForge PR Review Enforcement Hook
# Ensures fft-code-reviewer agent is used for PR reviews

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
NC='\033[0m'

# Get user message
USER_MESSAGE="${CLAUDE_USER_MESSAGE:-}"

# Check if this is about PR review
if [[ "$USER_MESSAGE" =~ (review|PR|pull request|merge|approve) ]]; then
    # Check if it's specifically about reviewing a PR
    if [[ "$USER_MESSAGE" =~ (review.*PR|review.*pull|check.*PR|analyze.*PR|look at.*#[0-9]+) ]]; then
        
        # Check if fft-code-reviewer was recently used
        LOG_FILE=".flowforge/logs/agent-usage.log"
        if [ -f "$LOG_FILE" ]; then
            # Check last 5 minutes
            five_min_ago=$(date -d '5 minutes ago' '+%Y-%m-%d %H:%M:%S' 2>/dev/null || date -v-5M '+%Y-%m-%d %H:%M:%S')
            if ! grep -q "fft-code-reviewer" "$LOG_FILE" 2>/dev/null || \
               ! grep "fft-code-reviewer" "$LOG_FILE" | tail -1 | cut -d'|' -f1 | xargs -I {} test "{}" ">" "$five_min_ago"; then
                
                echo -e "${PURPLE}════════════════════════════════════════${NC}"
                echo -e "${PURPLE}🔍 FlowForge Rule #35: PR Review Reminder${NC}"
                echo -e "${PURPLE}════════════════════════════════════════${NC}"
                echo ""
                echo -e "${YELLOW}📋 You're about to review a Pull Request${NC}"
                echo -e "${BLUE}Rule #35: ALWAYS use FlowForge agents when available${NC}"
                echo ""
                echo -e "${GREEN}✅ Required Action:${NC}"
                echo -e "Use the Task tool with:"
                echo -e "${PURPLE}'Act as fft-code-reviewer to analyze PR #[number]'${NC}"
                echo ""
                echo -e "${YELLOW}The fft-code-reviewer agent will:${NC}"
                echo -e "• Check code quality and standards"
                echo -e "• Verify FlowForge rules compliance"
                echo -e "• Analyze security implications"
                echo -e "• Ensure test coverage"
                echo -e "• Validate documentation"
                echo ""
                echo -e "${RED}⚠️  Manual PR review violates Rule #35${NC}"
                echo -e "${PURPLE}════════════════════════════════════════${NC}"
                
                # Don't block, but make it clear
                echo -e "\n${YELLOW}INSTRUCTION: Use fft-code-reviewer agent for this PR review${NC}"
            fi
        fi
    fi
fi

exit 0  # Don't block, just guide