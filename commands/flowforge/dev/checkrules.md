# Command: flowforge:dev:checkrules
# Version: 2.0.0
# Description: FlowForge dev checkrules command

---
description: Verify project compliance with FlowForge rules
---

# 📋 FlowForge Rules Compliance Check

## 🔧 Setup Error Handling
```bash
# Enable strict error handling
set -euo pipefail

# Error handler function
handle_error() {
    local exit_code=$?
    local line_number=$1
    echo "❌ Error on line $line_number (exit code: $exit_code)"
    
    # Provide helpful error messages based on context
    if [[ "${BASH_COMMAND:-}" =~ "RULES.md" ]]; then
        echo "💡 Could not find .flowforge/RULES.md file"
        echo "   Ensure you're in a FlowForge project directory"
    elif [[ "${BASH_COMMAND:-}" =~ "git" ]]; then
        echo "💡 Git command failed - ensure you're in a git repository"
    fi
    
    exit $exit_code
}

# Set error trap
trap 'handle_error $LINENO' ERR

# Enable debug mode if DEBUG=1
[[ "${DEBUG:-0}" == "1" ]] && set -x
```

## 📚 Show Help
```bash
# Check if help is requested
if [[ "${ARGUMENTS:-}" == "?" || "${ARGUMENTS:-}" == "help" ]]; then
    cat << 'EOF'
📋 FlowForge Rule Checker

Comprehensive compliance verification for FlowForge development rules.

Usage: /flowforge:dev:checkrules [rule-number]

Arguments:
  (none)         Check all rules
  <number>       Check specific rule by number
  help, ?        Show this help message

Examples:
  /flowforge:dev:checkrules           # Check all rules
  /flowforge:dev:checkrules 3         # Check rule #3 (TDD)
  /flowforge:dev:checkrules help      # Show this help

Rules are defined in .flowforge/RULES.md
EOF
    exit 0
fi
```

## 🔍 Validate Environment
```bash
# Check if we're in a FlowForge project
RULES_FILE=".flowforge/RULES.md"
if [ ! -f "$RULES_FILE" ]; then
    echo "❌ Error: .flowforge/RULES.md not found"
    echo ""
    echo "💡 This command must be run from a FlowForge project root"
    echo "   Looking for: $(pwd)/$RULES_FILE"
    exit 1
fi

# Initialize variables
RULE_NUMBER="${ARGUMENTS:-}"
VIOLATIONS=0
CHECKS=0
CURRENT_BRANCH=""
ISSUE_NUMBER=""

# Get current branch (gracefully handle non-git directories)
if command -v git &> /dev/null && git rev-parse --git-dir &> /dev/null 2>&1; then
    CURRENT_BRANCH=$(git branch --show-current 2>/dev/null || echo "unknown")
else
    CURRENT_BRANCH="not-in-git"
fi
```

## 📊 Define Rule Checks
```bash
# Rule check functions
check_rule_1_tdd() {
    echo "🔍 Rule #1: TDD First (80%+ coverage)"
    ((CHECKS++)) || true
    
    # Check for test files
    local test_count=$(find . -name "*test*" -type f 2>/dev/null | grep -E '\.(sh|js|ts|py)$' | wc -l || echo "0")
    
    if [ "$test_count" -gt 0 ]; then
        echo "  ✅ Found $test_count test files"
    else
        echo "  ⚠️  No test files found"
        echo "     Create tests in tests/ directory"
        ((VIOLATIONS++)) || true
    fi
}

check_rule_2_options() {
    echo "🔍 Rule #2: Present 3 Options"
    ((CHECKS++)) || true
    echo "  ℹ️  Manual verification required during implementation"
}

check_rule_3_issue() {
    echo "🔍 Rule #3: No Work Without Issue"
    ((CHECKS++)) || true
    
    # Extract issue number from branch name
    if [[ "$CURRENT_BRANCH" =~ ([0-9]+) ]]; then
        ISSUE_NUMBER="${BASH_REMATCH[1]}"
        echo "  ✅ Working on issue #$ISSUE_NUMBER (from branch: $CURRENT_BRANCH)"
    else
        echo "  ⚠️  No issue number found in branch name"
        echo "     Use branch pattern: feature/123-description"
        ((VIOLATIONS++)) || true
    fi
}

check_rule_4_branch() {
    echo "🔍 Rule #4: No Direct Main/Develop"
    ((CHECKS++)) || true
    
    if [[ "$CURRENT_BRANCH" == "main" || "$CURRENT_BRANCH" == "develop" ]]; then
        echo "  ❌ Currently on protected branch: $CURRENT_BRANCH"
        echo "     Create a feature branch: git checkout -b feature/issue-description"
        ((VIOLATIONS++)) || true
    else
        echo "  ✅ On feature branch: $CURRENT_BRANCH"
    fi
}

check_rule_5_no_ai() {
    echo "🔍 Rule #5: No AI References"
    ((CHECKS++)) || true
    
    # Check for AI references in staged/modified files
    if command -v git &> /dev/null && git rev-parse --git-dir &> /dev/null 2>&1; then
        local ai_refs=$(git grep -i -E "(chatgpt|gpt-|claude|copilot|ai.generated|artificial.intelligence)" 2>/dev/null | grep -v "CLAUDE_INSTANCE_ID" | wc -l || echo "0")
        
        if [ "$ai_refs" -eq 0 ]; then
            echo "  ✅ No AI references found in code"
        else
            echo "  ❌ Found $ai_refs AI references"
            echo "     Remove references to AI/ML models from output"
            ((VIOLATIONS++)) || true
        fi
    else
        echo "  ℹ️  Skipping AI reference check (not in git repository)"
    fi
}

# Get total rule count from RULES.md
get_total_rules() {
    # Try multiple patterns to find rule count
    local count=$(grep -E "(Total Rules:|rules total:|[0-9]+ rules)" "$RULES_FILE" 2>/dev/null | grep -oE "[0-9]+" | head -1)
    
    # If not found, count numbered rules
    if [ -z "$count" ]; then
        count=$(grep -E "^[0-9]+\." "$RULES_FILE" 2>/dev/null | wc -l)
    fi
    
    # Default to known count if still not found
    echo "${count:-34}"
}
```

## 🚀 Execute Rule Checks
```bash
# Main execution
echo "📋 FlowForge Rule Compliance Check"
echo "=================================="
echo ""

# Determine which rules to check
if [ -z "$RULE_NUMBER" ]; then
    # Check all rules
    echo "🔍 Checking all FlowForge rules..."
    echo ""
    
    # Run each check
    check_rule_1_tdd
    check_rule_2_options
    check_rule_3_issue
    check_rule_4_branch
    check_rule_5_no_ai
    
    # Note about remaining rules
    TOTAL_RULES=$(get_total_rules)
    echo ""
    echo "ℹ️  Checked 5 core rules. Total rules in RULES.md: $TOTAL_RULES"
    echo "   Full compliance check: .flowforge/hooks/enforce-all-rules.sh"
    
else
    # Check specific rule
    case "$RULE_NUMBER" in
        1) check_rule_1_tdd ;;
        2) check_rule_2_options ;;
        3) check_rule_3_issue ;;
        4) check_rule_4_branch ;;
        5) check_rule_5_no_ai ;;
        *)
            echo "❌ Invalid rule number: $RULE_NUMBER"
            echo "   Valid rules: 1-5 (core rules)"
            echo "   Use /flowforge:dev:checkrules without arguments to check all"
            exit 1
            ;;
    esac
fi
```

## 📈 Display Summary
```bash
# Show summary
echo ""
echo "📊 Summary"
echo "=========="
echo "Checks performed: $CHECKS"
echo "Violations found: $VIOLATIONS"

# Show status
if [ $VIOLATIONS -eq 0 ]; then
    echo ""
    echo "✅ All checked rules passed!"
    
    # Remind about manual checks
    if [ -z "$RULE_NUMBER" ]; then
        echo ""
        echo "📝 Remember to also:"
        echo "  • Write tests before code (TDD)"
        echo "  • Present 3 options before implementing"
        echo "  • Update documentation"
        echo "  • Track time with task-time.sh"
    fi
else
    echo ""
    echo "⚠️  Found $VIOLATIONS rule violations"
    echo "   Fix the issues above before proceeding"
    exit 1
fi
```

## 🔧 Additional Helpers
```bash
# Show current context if in debug mode
if [[ "${DEBUG:-0}" == "1" ]]; then
    echo ""
    echo "🔍 Debug Info:"
    echo "  Branch: $CURRENT_BRANCH"
    echo "  Issue: ${ISSUE_NUMBER:-none}"
    echo "  PWD: $(pwd)"
    echo "  Git: $(git --version 2>/dev/null || echo "not available")"
fi
```
