#!/bin/bash
# FlowForge Comprehensive Rule Enforcement System
# Enforces all 33 rules with blocking and warning capabilities

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Source FlowForge context
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Try to find context script
if [ -f "$SCRIPT_DIR/../scripts/flowforge-context.sh" ]; then
    source "$SCRIPT_DIR/../scripts/flowforge-context.sh"
elif [ -f "$SCRIPT_DIR/../../scripts/flowforge-context.sh" ]; then
    source "$SCRIPT_DIR/../../scripts/flowforge-context.sh"
else
    # Fallback detection
    if [ -f "RULES.md" ] && [ -f "VERSION" ]; then
        FF_ROOT="."
    elif [ -f ".flowforge/RULES.md" ]; then
        FF_ROOT=".flowforge"
    else
        FF_ROOT="."
    fi
fi

# Source FF-on-FF detection
if [ -f "$FF_ROOT/scripts/detect-ff-on-ff.sh" ]; then
    source "$FF_ROOT/scripts/detect-ff-on-ff.sh"
    IS_FF_ON_FF=$(is_flowforge_on_flowforge && echo "true" || echo "false")
else
    IS_FF_ON_FF="false"
fi

# Configuration using FF_ROOT
RULES_FILE="$FF_ROOT/RULES.md"
ENFORCEMENT_CONFIG="$FF_ROOT/config/enforcement.json"
WORKFLOW_FILE="documentation/development/CLAUDE_WORKFLOW.md"
NEXT_SESSION_FILE="documentation/development/.flowforge/sessions/current.json"

# Initialize enforcement config if not exists
if [ ! -f "$ENFORCEMENT_CONFIG" ]; then
    mkdir -p "$(dirname "$ENFORCEMENT_CONFIG")"
    echo '{"rules":{}}' > "$ENFORCEMENT_CONFIG"
fi

# Function to block with error
block_action() {
    local rule=$1
    local message=$2
    local fix=$3
    
    echo -e "\n${RED}❌ BLOCKED BY RULE #$rule${NC}"
    echo -e "${RED}📋 Rule: $(get_rule_title $rule)${NC}"
    echo -e "${RED}❗ Violation: $message${NC}"
    echo -e "${YELLOW}💡 Fix: $fix${NC}\n"
    exit 1
}

# Function to warn but allow
warn_action() {
    local rule=$1
    local message=$2
    local suggestion=$3
    
    echo -e "\n${YELLOW}⚠️  WARNING: Rule #$rule${NC}"
    echo -e "${YELLOW}📋 Rule: $(get_rule_title $rule)${NC}"
    echo -e "${YELLOW}⚡ Issue: $message${NC}"
    echo -e "${BLUE}💡 Suggestion: $suggestion${NC}\n"
}

# Get rule title from RULES.md
get_rule_title() {
    local rule_num=$1
    grep -E "^### $rule_num\." "$RULES_FILE" 2>/dev/null | sed 's/^### [0-9]\+\. //' || echo "Rule #$rule_num"
}

# Rule 1: Documentation Organization
check_rule_1() {
    # Only check MD files that are being added or modified in this commit
    local staged_md_files=$(git diff --cached --name-only --diff-filter=AM | grep '\.md$' || true)
    
    if [ -z "$staged_md_files" ]; then
        # No MD files being added/modified, nothing to check
        return 0
    fi
    
    # Check each staged MD file against allowed locations
    local docs_outside=""
    while IFS= read -r file; do
        # Skip if file is in allowed location
        if [[ "$file" == "documentation/"* ]] || \
           [[ "$file" == "README.md" ]] || \
           [[ "$file" == "CLAUDE.md" ]] || \
           [[ "$file" == ".flowforge/"* ]] || \
           [[ "$file" == ".claude/"* ]] || \
           [[ "$file" == "CHANGELOG.md" ]] || \
           [[ "$file" == "GETTING_STARTED.md" ]] || \
           [[ "$file" == "RULES.md" ]] || \
           [[ "$file" == ".flowforge/tasks.json" ]] || \
           [[ "$file" == "SCHEDULE.md" ]] || \
           [[ "$file" == "commands/"* ]] || \
           [[ "$file" == "automation/"* ]] || \
           [[ "$file" == "templates/"* ]] || \
           [[ "$file" == "agents/"* ]] || \
           [[ "$file" == "assets/"* ]] || \
           [[ "$file" == "tests/"* ]] || \
           [[ "$file" == "scripts/"* ]] || \
           [[ "$file" == "docs/"* ]] || \
           [[ "$file" == "developer-productivity-framework/"* ]] || \
           [[ "$file" == "ffReports/"* ]] || \
           [[ "$file" == "TASK_REPORT_"* ]]; then
            continue
        fi
        
        # File is outside allowed locations
        docs_outside="${docs_outside}${file}\n"
    done <<< "$staged_md_files"
    
    # Remove trailing newline
    docs_outside="${docs_outside%\\n}"
    
    # Only block if there are MD files outside allowed locations
    if [ -n "$docs_outside" ]; then
        echo -e "${RED}Files violating Rule #1:${NC}"
        echo -e "$docs_outside"
        block_action 1 \
            "Documentation files found outside /documentation directory" \
            "Move these files to appropriate subdirectories under /documentation"
    fi
}

# Rule 2: Planning Before Implementation
check_rule_2() {
    if [ "$1" == "start-work" ]; then
        if ! grep -q "Approved Plan" "$WORKFLOW_FILE" 2>/dev/null; then
            warn_action 2 \
                "No approved plan found in CLAUDE_WORKFLOW.md" \
                "Document your plan and get approval before implementation"
        fi
    fi
}

# Rule 3: Testing Requirements
check_rule_3() {
    if [ -f "package.json" ] && command -v npm &> /dev/null; then
        # Check for new files without tests
        local new_files=$(git diff --cached --name-only --diff-filter=A | grep -E '\.(ts|js)$' | grep -v test | grep -v spec)
        for file in $new_files; do
            local test_file=$(echo "$file" | sed 's/\.ts$/.test.ts/' | sed 's/\.js$/.test.js/' | sed 's/src/tests/')
            if [ ! -f "$test_file" ]; then
                block_action 3 \
                    "New file '$file' has no corresponding test file" \
                    "Create test file at '$test_file' with at least 3 test cases"
            fi
        done
        
        # Check coverage if available
        if [ -f "coverage/coverage-summary.json" ]; then
            local coverage=$(jq -r '.total.lines.pct' coverage/coverage-summary.json 2>/dev/null || echo "0")
            if (( $(echo "$coverage < 80" | bc -l) )); then
                warn_action 3 \
                    "Test coverage is ${coverage}%, below 80% requirement" \
                    "Add more tests to increase coverage"
            fi
        fi
    fi
}

# Rule 4: Documentation Updates
check_rule_4() {
    local code_changes=$(git diff --cached --name-only | grep -E '\.(ts|js|py|go)$' | wc -l)
    local doc_changes=$(git diff --cached --name-only | grep -E '\.(md)$' | wc -l)
    
    if [ "$code_changes" -gt 5 ] && [ "$doc_changes" -eq 0 ]; then
        warn_action 4 \
            "Significant code changes without documentation updates" \
            "Update relevant documentation for your changes"
    fi
}

# Rule 5: GitHub Issue Management
check_rule_5() {
    local branch=$(git branch --show-current 2>/dev/null)
    
    # Check if this is initial FlowForge setup
    if git diff --cached --name-only | grep -q "^\.flowforge$\|^\.gitmodules$" && \
       git diff --cached --name-only | grep -q "\.flowforge/"; then
        echo -e "${GREEN}✓ FlowForge initial setup - Rule #5 exempted${NC}"
        return 0
    fi
    
    # FF-on-FF: Allow quick fixes without issues for internal development
    if [[ "$IS_FF_ON_FF" == "true" ]]; then
        # Still require issue numbers, but be more lenient
        if ! [[ "$branch" =~ ([0-9]+) ]]; then
            # Check if it's a maintenance branch
            if [[ "$branch" =~ ^(fix|chore|docs)/.+$ ]]; then
                warn_action 5 \
                    "FF-on-FF: No GitHub issue number in branch name" \
                    "Consider creating an issue for tracking: git checkout -b feature/[issue]-description"
                return 0
            else
                block_action 5 \
                    "No GitHub issue number in branch name" \
                    "Create an issue first, then: git checkout -b feature/[issue]-description"
            fi
        fi
    else
        # Regular projects: Strict enforcement
        if ! [[ "$branch" =~ ([0-9]+) ]]; then
            block_action 5 \
                "No GitHub issue number in branch name" \
                "Create an issue first, then: git checkout -b feature/[issue]-description"
        fi
    fi
    
    local issue_num="${BASH_REMATCH[1]}"
    
    # Check if time tracking is active
    if [ -f ".task-times.json" ]; then
        local timer_status=$(jq -r --arg issue "$issue_num" '.[$issue].status // "none"' .task-times.json 2>/dev/null)
        if [[ "$timer_status" != "active" ]] && [[ "$1" == "start-work" ]]; then
            block_action 5 \
                "No active timer for issue #$issue_num" \
                "./.flowforge/scripts/task-time.sh start $issue_num"
        fi
    fi
}

# Rule 6: Task Tracking in CLAUDE_WORKFLOW.md
check_rule_6() {
    if [ "$1" == "end-work" ]; then
        local today=$(date +%Y-%m-%d)
        if ! grep -q "$today" "$WORKFLOW_FILE" 2>/dev/null; then
            block_action 6 \
                "CLAUDE_WORKFLOW.md not updated today" \
                "Update CLAUDE_WORKFLOW.md with today's progress"
        fi
    fi
}

# Rule 8: Code Quality Standards
check_rule_8() {
    local staged_files=$(git diff --cached --name-only --diff-filter=AM | grep -E '\.(ts|js)$' || true)
    
    for file in $staged_files; do
        # Skip test files - they legitimately need to test console output
        if [[ "$file" =~ \.(test|spec)\.(ts|js)$ ]]; then
            continue
        fi
        
        # Check for console.log (only actual function calls, not comments or strings)
        # This regex catches console.log( but not:
        # - Comments containing console.log
        # - Strings containing "console.log"  
        # - Property references like .toBe(console.log)
        if grep -n "console\.log\s*(" "$file" 2>/dev/null | grep -v "//" | grep -v "^\s*\*" | grep -v "flowforge-ignore-rule-8" > /dev/null; then
            block_action 8 \
                "console.log found in $file" \
                "Remove console.log or use proper logging"
        fi
        
        # Check for proper error handling
        if grep -E "(catch.*{[\s]*}|catch.*{[\s]*//)" "$file" 2>/dev/null; then
            block_action 8 \
                "Empty catch block found in $file" \
                "Implement proper error handling"
        fi
    done
}

# Rule 10: Database Consistency
check_rule_10() {
    local migration_files=$(git diff --cached --name-only | grep -E 'migrations?/.*\.sql$' || true)
    
    for file in $migration_files; do
        # Check for required fields
        if grep -iE "CREATE TABLE" "$file" 2>/dev/null; then
            if ! grep -iE "id.*UUID.*PRIMARY KEY.*DEFAULT uuid_generate_v4\(\)" "$file"; then
                block_action 10 \
                    "Table in $file missing standard id field" \
                    "Add: id UUID PRIMARY KEY DEFAULT uuid_generate_v4()"
            fi
            
            if ! grep -iE "created_at.*TIMESTAMP.*DEFAULT CURRENT_TIMESTAMP" "$file"; then
                block_action 10 \
                    "Table in $file missing created_at field" \
                    "Add: created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP"
            fi
        fi
    done
}

# Rule 11: Session Continuity
check_rule_11() {
    if [ "$1" == "end-work" ]; then
        local today=$(date +%Y-%m-%d)
        if ! grep -q "$today" "$NEXT_SESSION_FILE" 2>/dev/null; then
            block_action 11 \
                ".flowforge/sessions/current.json not updated for next session" \
                "Update .flowforge/sessions/current.json with current state and next steps"
        fi
    fi
}

# Rule 12: Task Completion Approval
check_rule_12() {
    if [ "$1" == "close-task" ]; then
        local issue_num="$2"
        # This would need GitHub API integration
        warn_action 12 \
            "Ensure you have approval before closing issue #$issue_num" \
            "Get approval comment on GitHub issue"
    fi
}

# Rule 14: Decision Documentation Requirements
check_rule_14() {
    local significant_changes=$(git diff --cached --name-only | grep -E '\.(ts|js|py|go)$' | wc -l)
    
    if [ "$significant_changes" -gt 10 ]; then
        local adr_exists=$(find documentation/architecture -name "adr-*.md" -newer .git/FETCH_HEAD 2>/dev/null | wc -l)
        if [ "$adr_exists" -eq 0 ]; then
            warn_action 14 \
                "Significant changes without Architecture Decision Record" \
                "Create an ADR in documentation/architecture/"
        fi
    fi
}

# Rule 15: Documentation Organization Standards
check_rule_15() {
    # Only check documentation files that are being added or modified in this commit
    local staged_docs=$(git diff --cached --name-only --diff-filter=AM | grep '^documentation/.*\.md$' || true)
    
    if [ -z "$staged_docs" ]; then
        # No documentation files being added/modified, nothing to check
        return 0
    fi
    
    # Check each staged documentation file
    local bad_names=""
    while IFS= read -r file; do
        # Check if file is in an approved subdirectory
        # TEMPORARY: Allow 2.0/ subdirectory during v2.0 development
        if ! echo "$file" | grep -qE '^documentation/(api|architecture|database|development|project|testing|newplan|wisdom|2\.0)/' && \
           ! echo "$file" | grep -q 'README' && \
           ! echo "$file" | grep -qE '^documentation/[A-Z_]+\.md$'; then
            bad_names="${bad_names}${file}\n"
        fi
    done <<< "$staged_docs"
    
    # Remove trailing newline
    bad_names="${bad_names%\\n}"
    
    if [ -n "$bad_names" ]; then
        echo -e "${RED}Files violating Rule #15:${NC}"
        echo -e "$bad_names"
        block_action 15 \
            "Documentation files in wrong directories" \
            "Move files to correct subdirectories under /documentation"
    fi
}

# Rule 18: Git Flow Compliance
check_rule_18() {
    local branch=$(git branch --show-current 2>/dev/null)
    
    # Block protected branches
    if [[ "$branch" == "main" || "$branch" == "master" || "$branch" == "develop" ]]; then
        block_action 18 \
            "Cannot work directly on protected branch '$branch'" \
            "Create feature branch: git checkout -b feature/[issue]-description"
    fi
    
    # Check branch naming
    if ! [[ "$branch" =~ ^(feature|bugfix|hotfix|chore|docs|refactor)/[0-9]+-[a-z0-9-]+$ ]]; then
        warn_action 18 \
            "Branch name '$branch' doesn't follow naming convention" \
            "Use format: type/issue-description (e.g., feature/123-add-login)"
    fi
}

# Rule 19: Database Change Protocol
check_rule_19() {
    local migration_files=$(git diff --cached --name-only | grep -E 'migrations?/.*\.sql$' || true)
    
    if [ -n "$migration_files" ]; then
        if ! grep -q "Database Change Approval" "$WORKFLOW_FILE" 2>/dev/null; then
            block_action 19 \
                "Database changes without documented approval" \
                "Get approval and document in CLAUDE_WORKFLOW.md"
        fi
    fi
}

# Rule 22: Check Workflow Documentation Before Starting
check_rule_22() {
    if [ "$1" == "start-work" ]; then
        local issue_num="$2"
        if ! grep -q "Issue #$issue_num" "$WORKFLOW_FILE" 2>/dev/null; then
            block_action 22 \
                "Issue #$issue_num not found in CLAUDE_WORKFLOW.md" \
                "Add task to CLAUDE_WORKFLOW.md before starting"
        fi
    fi
}

# Rule 23: Consistent Architecture and Patterns
check_rule_23() {
    local new_files=$(git diff --cached --name-only --diff-filter=A | grep -E '\.(ts|js)$')
    
    for file in $new_files; do
        # Check service files
        if [[ "$file" == *"service"* ]] && [[ "$file" != *".test."* ]]; then
            if ! grep -E "class.*Service" "$file" 2>/dev/null; then
                warn_action 23 \
                    "Service file $file doesn't follow class pattern" \
                    "Use class-based services with dependency injection"
            fi
        fi
    done
}

# Rule 24: Code Organization and File Size Limits
check_rule_24() {
    local large_files=$(git diff --cached --name-only | while read file; do
        if [ -f "$file" ] && [[ "$file" =~ \.(ts|js|py|go)$ ]]; then
            lines=$(wc -l < "$file")
            if [ "$lines" -gt 700 ]; then
                echo "$file:$lines"
            fi
        fi
    done)
    
    if [ -n "$large_files" ]; then
        for file_info in $large_files; do
            file=$(echo "$file_info" | cut -d: -f1)
            lines=$(echo "$file_info" | cut -d: -f2)
            block_action 24 \
                "File $file has $lines lines (max 700)" \
                "Split into smaller, focused modules"
        done
    fi
}

# Rule 25: Testing & Reliability
check_rule_25() {
    if [ -f "package.json" ]; then
        # Run tests
        local test_result=$(npm test -- --run 2>&1 || true)
        if echo "$test_result" | grep -q "failed"; then
            block_action 25 \
                "Tests are failing" \
                "Fix all failing tests before committing"
        fi
    fi
}

# Rule 26: Function Documentation
check_rule_26() {
    local ts_files=$(git diff --cached --name-only --diff-filter=AM | grep -E '\.ts$' || true)
    
    for file in $ts_files; do
        # Check for public methods without JSDoc
        if grep -E "^\s*public\s+\w+\s*\(" "$file" 2>/dev/null | grep -B1 -v "^\s*/\*\*"; then
            warn_action 26 \
                "Public methods in $file missing JSDoc documentation" \
                "Add JSDoc comments to all public methods"
        fi
    done
}

# Rule 28: AI Behavior Rules
check_rule_28() {
    local import_errors=""
    local error_details=""
    
    # Process each staged file
    git diff --cached --name-only | while read file; do
        if [[ "$file" =~ \.(ts|js)$ ]] && [ -f "$file" ]; then
            # Check for imports of non-existent files
            grep -E "^import.*from\s+['\"]\./" "$file" 2>/dev/null | while read import_line; do
                # Extract the import path
                import_path=$(echo "$import_line" | sed -E "s/.*from\s+['\"](.+)['\"].*/\1/")
                
                # Calculate the resolved path
                file_dir=$(dirname "$file")
                resolved_path="${file_dir}/${import_path}"
                
                # Normalize path (resolve .. and .)
                resolved_path=$(cd "$file_dir" 2>/dev/null && realpath -m "${import_path}" 2>/dev/null || echo "$resolved_path")
                
                # Check various possible file extensions and index files
                local found=false
                for ext in ".ts" ".js" ".tsx" ".jsx" ""; do
                    for index in "" "/index"; do
                        test_path="${resolved_path}${index}${ext}"
                        if [ -f "$test_path" ] || [ -d "${resolved_path}" ]; then
                            found=true
                            break 2
                        fi
                    done
                done
                
                if [ "$found" = false ]; then
                    # Build detailed error message
                    echo "ERROR: Import of non-existent module detected!"
                    echo "  File: $file"
                    echo "  Line: $import_line"
                    echo "  Import path: $import_path"
                    echo "  Resolved to: $resolved_path"
                    echo "  Checked locations:"
                    echo "    - ${resolved_path}.ts"
                    echo "    - ${resolved_path}.js"
                    echo "    - ${resolved_path}.tsx"
                    echo "    - ${resolved_path}.jsx"
                    echo "    - ${resolved_path}/index.ts"
                    echo "    - ${resolved_path}/index.js"
                    echo ""
                fi
            done
        fi
    done | tee /tmp/rule28_errors.txt
    
    # Check if any errors were found
    if [ -s /tmp/rule28_errors.txt ]; then
        import_errors=$(cat /tmp/rule28_errors.txt)
        rm -f /tmp/rule28_errors.txt
        
        # Display the detailed error information
        echo -e "${RED}✗ Rule #28: Import validation failed${NC}"
        echo "$import_errors"
        
        block_action 28 \
            "Import of non-existent module(s) detected - see details above" \
            "Fix import paths or create missing modules"
    fi
    
    # Clean up temp file if it exists
    rm -f /tmp/rule28_errors.txt
}

# Rule 31: Documentation Organization (duplicate of Rule 1, skip)

# Rule 32: Database Standards Compliance
check_rule_32() {
    local entity_files=$(git diff --cached --name-only | grep -E 'entities?/.*\.(ts|js)$' || true)
    
    for file in $entity_files; do
        # Check for required fields
        required_fields=("id" "active" "created_at" "updated_at" "deleted_at")
        for field in "${required_fields[@]}"; do
            if ! grep -q "$field" "$file" 2>/dev/null; then
                block_action 32 \
                    "Entity in $file missing required field: $field" \
                    "Add all required fields: ${required_fields[*]}"
            fi
        done
    done
}

# Rule 33: No AI Tool References
check_rule_33() {
    # FF-on-FF: Skip this rule entirely for FlowForge development
    if [[ "$IS_FF_ON_FF" == "true" ]]; then
        echo -e "${GREEN}✓ Rule #33 skipped (FF-on-FF mode)${NC}"
        return 0
    fi
    
    # Check commit message
    local commit_msg_file="$1"
    if [ -f "$commit_msg_file" ]; then
        if grep -iE "(claude|anthropic|chatgpt|copilot|ai.assisted|generated.by.ai|artificial.intelligence)" "$commit_msg_file"; then
            block_action 33 \
                "AI tool references found in commit message" \
                "Remove all AI tool references from commit message"
        fi
    fi
    
    # Check staged files
    local staged_files=$(git diff --cached --name-only --diff-filter=AM)
    for file in $staged_files; do
        # Skip FlowForge's own files that legitimately reference AI tools
        # These are internal configuration/command files, not customer deliverables
        if [[ "$file" =~ ^\.claude/ ]] || \
           [[ "$file" =~ ^\.flowforge/ ]] || \
           [[ "$file" =~ ^automation/claude-code/ ]] || \
           [[ "$file" =~ ^commands/ ]] || \
           [[ "$file" =~ ^scripts/ ]] || \
           [[ "$file" =~ ^tests/ ]] || \
           [[ "$file" =~ ^agents/ ]] || \
           [[ "$file" == "CLAUDE.md" ]] || \
           [[ "$file" == "documentation/COMMANDS.md" ]] || \
           [[ "$file" =~ ^documentation/development/ ]] || \
           [[ "$file" =~ ^documentation/wisdom/ ]] || \
           [[ "$file" =~ ^documentation/newplan/ ]] || \
           [[ "$file" =~ \.flowforge.*\.md$ ]]; then
            continue
        fi
        
        if [ -f "$file" ] && grep -iE "(claude|anthropic|chatgpt|copilot|ai.assisted|generated.by.ai|artificial.intelligence)" "$file" 2>/dev/null; then
            block_action 33 \
                "AI tool references found in $file" \
                "Remove all AI tool references from the file"
        fi
    done
}

# Main enforcement function
enforce_rules() {
    local context="${1:-general}"
    local extra_arg="${2:-}"
    
    # Check for emergency bypass flags in commit message
    if [ -f "$extra_arg" ]; then
        if grep -E "\[(skip-rules|emergency|bypass-flowforge)\]" "$extra_arg" >/dev/null 2>&1; then
            echo -e "${YELLOW}⚠️  FlowForge rules bypassed - Emergency mode${NC}"
            echo -e "${YELLOW}📋 Reason: Found bypass flag in commit message${NC}"
            echo -e "${RED}🚨 Remember: This should only be used in emergencies!${NC}\n"
            return 0
        fi
    fi
    
    echo -e "${BLUE}🔒 FlowForge Rule Enforcement System${NC}"
    if [[ "$IS_FF_ON_FF" == "true" ]]; then
        echo -e "${YELLOW}🔧 FF-on-FF Mode: FlowForge developing FlowForge${NC}"
    fi
    echo -e "${BLUE}📋 Checking all 33 rules...${NC}\n"
    
    # Always check critical rules
    check_rule_18  # Git flow
    check_rule_5   # GitHub issue
    
    case "$context" in
        "pre-commit")
            check_rule_1   # Documentation organization
            check_rule_3   # Testing requirements
            check_rule_4   # Documentation updates
            check_rule_8   # Code quality
            check_rule_10  # Database consistency
            check_rule_14  # Decision documentation
            check_rule_15  # Doc organization standards
            check_rule_19  # Database change protocol
            check_rule_23  # Architecture patterns
            check_rule_24  # File size limits
            check_rule_25  # Testing reliability
            check_rule_26  # Function documentation
            check_rule_28  # AI behavior
            check_rule_32  # Database standards
            check_rule_33 "$extra_arg"  # No AI references
            ;;
            
        "start-work")
            check_rule_2   # Planning
            check_rule_5   # Issue management
            check_rule_22  # Workflow check
            ;;
            
        "end-work")
            check_rule_6   # Task tracking
            check_rule_11  # Session continuity
            ;;
            
        "close-task")
            check_rule_12 "$extra_arg"  # Approval required
            ;;
            
        *)
            # Run all checks
            check_rule_1
            check_rule_3
            check_rule_8
            check_rule_18
            check_rule_33
            ;;
    esac
    
    echo -e "${GREEN}✅ All rule checks completed${NC}"
}

# Run enforcement
enforce_rules "$@"