#!/bin/bash
# Setup FlowForge enforcement hooks in git

set -e

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${BLUE}🔒 Setting up FlowForge Rule Enforcement Hooks${NC}"

# Ensure we're in a git repository
if [ ! -d ".git" ]; then
    echo -e "${RED}❌ Not a git repository${NC}"
    exit 1
fi

# Create hooks directory if it doesn't exist
mkdir -p .git/hooks

# Pre-commit hook
echo -e "${BLUE}📝 Creating pre-commit hook...${NC}"
cat > .git/hooks/pre-commit << 'EOF'
#!/bin/bash
# FlowForge Pre-commit Hook - Enforces all rules

# Run the comprehensive rule enforcement
if [ -f ".flowforge/hooks/enforce-all-rules.sh" ]; then
    ./.flowforge/hooks/enforce-all-rules.sh pre-commit
    if [ $? -ne 0 ]; then
        echo "❌ Pre-commit blocked by FlowForge rules"
        exit 1
    fi
else
    echo "⚠️  FlowForge enforcement not found - run installation"
fi

# Run documentation pattern enforcement
if [ -f ".flowforge/hooks/pre-commit-docs.sh" ]; then
    # Capture output to show full error details
    output=$(./.flowforge/hooks/pre-commit-docs.sh 2>&1)
    exit_code=$?
    
    # Always show the output so users can see what's wrong
    echo "$output"
    
    if [ $exit_code -ne 0 ]; then
        echo ""
        echo "❌ Pre-commit blocked by documentation issues"
        echo "💡 Fix the errors listed above and try again"
        exit 1
    fi
fi

# Check if documentation updates are required
if [ -f ".flowforge/hooks/enforce-doc-updates.sh" ]; then
    ./.flowforge/hooks/enforce-doc-updates.sh
    if [ $? -ne 0 ]; then
        echo "❌ Pre-commit blocked - documentation update required"
        exit 1
    fi
fi
EOF
chmod +x .git/hooks/pre-commit

# Commit-msg hook
echo -e "${BLUE}📝 Creating commit-msg hook...${NC}"
cat > .git/hooks/commit-msg << 'EOF'
#!/bin/bash
# FlowForge Commit Message Hook

# Run Rule #33 check (No AI references)
if [ -f ".flowforge/hooks/enforce-all-rules.sh" ]; then
    ./.flowforge/hooks/enforce-all-rules.sh pre-commit "$1"
    if [ $? -ne 0 ]; then
        exit 1
    fi
fi

# Check conventional commit format
commit_regex='^(feat|fix|docs|style|refactor|test|chore|perf|ci|build|revert)(\(.+\))?: .{1,50}'

if ! grep -qE "$commit_regex" "$1"; then
    echo "❌ Invalid commit message format!"
    echo "Format: <type>(<scope>): <subject>"
    echo "Example: feat(auth): add login endpoint"
    echo ""
    echo "Types: feat|fix|docs|style|refactor|test|chore|perf|ci|build|revert"
    exit 1
fi
EOF
chmod +x .git/hooks/commit-msg

# Post-checkout hook for branch compliance
echo -e "${BLUE}📝 Creating post-checkout hook...${NC}"
cat > .git/hooks/post-checkout << 'EOF'
#!/bin/bash
# FlowForge Post-checkout Hook

# Only run on branch checkout (not file checkout)
if [ "$3" == "1" ]; then
    if [ -f ".flowforge/hooks/enforce-all-rules.sh" ]; then
        ./.flowforge/hooks/enforce-all-rules.sh general
    fi
fi
EOF
chmod +x .git/hooks/post-checkout

# Pre-push hook
echo -e "${BLUE}📝 Creating pre-push hook...${NC}"
cat > .git/hooks/pre-push << 'EOF'
#!/bin/bash
# FlowForge Pre-push Hook

# Ensure tests pass before push
if [ -f ".flowforge/hooks/enforce-all-rules.sh" ]; then
    # Run specific push checks
    ./.flowforge/hooks/enforce-all-rules.sh pre-push
    if [ $? -ne 0 ]; then
        echo "❌ Push blocked by FlowForge rules"
        exit 1
    fi
fi
EOF
chmod +x .git/hooks/pre-push

# Create custom hooks for FlowForge commands
echo -e "${BLUE}📝 Creating FlowForge command hooks...${NC}"

# Start work hook
cat > .git/hooks/flowforge-start-work << 'EOF'
#!/bin/bash
# Called when starting work on an issue

ISSUE_NUM="$1"

if [ -f ".flowforge/hooks/enforce-all-rules.sh" ]; then
    ./.flowforge/hooks/enforce-all-rules.sh start-work "$ISSUE_NUM"
    if [ $? -ne 0 ]; then
        echo "❌ Cannot start work - rule violations detected"
        exit 1
    fi
fi

# Auto-create branch if on main/develop
CURRENT_BRANCH=$(git branch --show-current)
if [[ "$CURRENT_BRANCH" == "main" || "$CURRENT_BRANCH" == "develop" ]]; then
    echo "📌 Creating feature branch..."
    git checkout -b "feature/$ISSUE_NUM-work"
fi

# Start timer
if [ -f ".flowforge/scripts/task-time.sh" ]; then
    ./.flowforge/scripts/task-time.sh start "$ISSUE_NUM"
fi
EOF
chmod +x .git/hooks/flowforge-start-work

# End work hook
cat > .git/hooks/flowforge-end-work << 'EOF'
#!/bin/bash
# Called when ending work session

if [ -f ".flowforge/hooks/enforce-all-rules.sh" ]; then
    ./.flowforge/hooks/enforce-all-rules.sh end-work
    if [ $? -ne 0 ]; then
        echo "❌ Cannot end work - rule violations detected"
        echo "📝 Please update required documentation"
        exit 1
    fi
fi
EOF
chmod +x .git/hooks/flowforge-end-work

echo -e "${GREEN}✅ FlowForge enforcement hooks installed!${NC}"
echo ""
echo -e "${YELLOW}📋 Hooks installed:${NC}"
echo "  • pre-commit    - Enforces all rules + documentation patterns"
echo "  • commit-msg    - Validates commit messages + AI references"
echo "  • post-checkout - Checks branch compliance"
echo "  • pre-push      - Final checks before push"
echo "  • flowforge-*   - Custom workflow hooks"
echo ""
echo -e "${YELLOW}📚 Documentation enforcement:${NC}"
echo "  • Pattern validation - Ensures docs follow FlowForge structure"
echo "  • Update requirements - Blocks commits without required doc updates"
echo "  • Link validation - Checks for broken internal links"
echo "  • Quality checks - Validates markdown formatting"
echo ""
echo -e "${BLUE}💡 Rules are now actively enforced!${NC}"