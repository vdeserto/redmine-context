#!/bin/bash
# FlowForge Pre-commit Hook - Check for AI References
# Enforces Rule #33: No AI tool references in client-facing output

set -e

# Colors
RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
NC='\033[0m'

# AI-related keywords to check
AI_KEYWORDS=(
    "claude"
    "Claude"
    "AI-generated"
    "AI-assisted"
    "Generated with"
    "Created by AI"
    "AI assistant"
    "artificial intelligence"
    "machine learning"
    "LLM"
    "GPT"
    "OpenAI"
    "Anthropic"
)

echo -e "${YELLOW}🔍 FlowForge: Checking for AI references (Rule #33)...${NC}"

# Check staged files for AI references
FOUND_ISSUES=0

# Check commit message
COMMIT_MSG_FILE=$1
if [ -f "$COMMIT_MSG_FILE" ]; then
    for keyword in "${AI_KEYWORDS[@]}"; do
        if grep -qi "$keyword" "$COMMIT_MSG_FILE"; then
            echo -e "${RED}❌ Commit message contains AI reference: '$keyword'${NC}"
            echo -e "${YELLOW}   Rule #33: No AI references in commits${NC}"
            FOUND_ISSUES=1
        fi
    done
fi

# Check staged files
STAGED_FILES=$(git diff --cached --name-only --diff-filter=ACM)

for file in $STAGED_FILES; do
    # Skip checking internal FlowForge files and documentation
    if [[ "$file" =~ ^\.flowforge/ ]] || \
       [[ "$file" =~ CLAUDE\.md$ ]] || \
       [[ "$file" =~ CLAUDE_.*\.md$ ]] || \
       [[ "$file" =~ ^agents/ ]] || \
       [[ "$file" =~ ^templates/agents/ ]] || \
       [[ "$file" =~ ^documentation/development/ ]] || \
       [[ "$file" =~ ^commands/ ]] || \
       [[ "$file" =~ ^scripts/ ]] || \
       [[ "$file" =~ ^hooks/ ]]; then
        continue
    fi
    
    # Check different file types
    case "$file" in
        *.md|*.txt|*.rst)
            # Documentation files
            for keyword in "${AI_KEYWORDS[@]}"; do
                if git diff --cached "$file" | grep -qi "$keyword"; then
                    echo -e "${RED}❌ $file contains AI reference: '$keyword'${NC}"
                    FOUND_ISSUES=1
                fi
            done
            ;;
        *.js|*.ts|*.jsx|*.tsx|*.py|*.go|*.rs|*.java|*.c|*.cpp|*.h|*.hpp)
            # Source code files - check comments
            for keyword in "${AI_KEYWORDS[@]}"; do
                # Check for keywords in comments (// or /* */ or #)
                if git diff --cached "$file" | grep -E '(//|/\*|#)' | grep -qi "$keyword"; then
                    echo -e "${RED}❌ $file contains AI reference in comments: '$keyword'${NC}"
                    FOUND_ISSUES=1
                fi
            done
            ;;
        *.json|*.yaml|*.yml|*.toml)
            # Configuration files
            for keyword in "${AI_KEYWORDS[@]}"; do
                if git diff --cached "$file" | grep -qi "$keyword"; then
                    echo -e "${YELLOW}⚠️  $file contains AI reference: '$keyword'${NC}"
                    echo -e "${YELLOW}   Please verify this is not client-facing${NC}"
                fi
            done
            ;;
    esac
done

if [ $FOUND_ISSUES -eq 1 ]; then
    echo ""
    echo -e "${RED}❌ AI references found in staged changes!${NC}"
    echo -e "${YELLOW}Rule #33: Professional Output Standards${NC}"
    echo ""
    echo "Clients pay for developer expertise, not AI usage."
    echo "Please remove AI references from:"
    echo "  - Commit messages"
    echo "  - Code comments"
    echo "  - Documentation"
    echo "  - Any client-facing output"
    echo ""
    echo "To bypass this check (not recommended):"
    echo "  git commit --no-verify"
    echo ""
    exit 1
else
    echo -e "${GREEN}✅ No AI references found - Rule #33 compliance passed!${NC}"
fi

exit 0