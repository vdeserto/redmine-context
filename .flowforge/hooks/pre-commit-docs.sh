#!/bin/bash
# FlowForge Pre-commit Documentation Hook

set -euo pipefail

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

# Get the directory of this script
HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Function to check if documentation needs updating
check_docs_need_update() {
    local changed_files=$(git diff --cached --name-only)
    local code_changed=false
    local docs_changed=false
    
    # Check if code files changed
    if echo "$changed_files" | grep -E "\.(js|ts|jsx|tsx|py|go|rs)$" >/dev/null; then
        code_changed=true
    fi
    
    # Check if documentation changed
    if echo "$changed_files" | grep -E "\.(md|MD)$" >/dev/null; then
        docs_changed=true
    fi
    
    # If code changed but not docs, warn
    if [ "$code_changed" = true ] && [ "$docs_changed" = false ]; then
        echo -e "${YELLOW}⚠️  Code changes detected without documentation updates${NC}"
        echo -e "${YELLOW}   Consider updating:${NC}"
        echo -e "${YELLOW}   - README.md (if features changed)${NC}"
        echo -e "${YELLOW}   - API documentation (if endpoints changed)${NC}"
        echo -e "${YELLOW}   - CLAUDE.md (if architecture changed)${NC}"
    fi
}

# Function to validate markdown files
validate_markdown() {
    local file=$1
    local errors=0
    
    # Check for merge conflicts
    if grep -E "^(<<<<<<<|=======|>>>>>>>)" "$file" >/dev/null 2>&1; then
        echo -e "${RED}❌ Merge conflict markers in $file${NC}"
        ((errors++))
    fi
    
    # Check for broken internal links
    while IFS= read -r link; do
        # Extract path from markdown link
        local path=$(echo "$link" | sed -E 's/.*\]\(([^)#]+)(#[^)]+)?\).*/\1/')
        
        # Skip external links and anchors
        if [[ "$path" =~ ^https?:// ]] || [[ "$path" =~ ^# ]] || [ -z "$path" ]; then
            continue
        fi
        
        # Check if linked file exists
        if [ ! -f "$path" ] && [ ! -d "$path" ]; then
            echo -e "${RED}❌ Broken link in $file: $path${NC}"
            ((errors++))
        fi
    done < <(grep -oE '\[[^]]+\]\([^)]+\)' "$file" 2>/dev/null || true)
    
    return $errors
}

# Function to enforce documentation patterns
enforce_patterns() {
    local errors=0
    
    # Check staged markdown files
    local staged_md_files=$(git diff --cached --name-only --diff-filter=AM | grep -E "\.(md|MD)$" || true)
    
    for file in $staged_md_files; do
        echo -e "${BLUE}🔍 Checking $file...${NC}"
        
        # Skip if file doesn't exist (deleted)
        [ -f "$file" ] || continue
        
        # Validate markdown
        validate_markdown "$file"
        errors=$((errors + $?))
        
        # Check specific files for required patterns
        case "$file" in
            "README.md")
                # README must have FlowForge badge if it's a FlowForge project
                if [ -f ".flowforge/config.json" ] && ! grep -q "FlowForge" "$file"; then
                    echo -e "${YELLOW}⚠️  README.md should mention FlowForge integration${NC}"
                fi
                ;;
                
            "CLAUDE.md")
                # CLAUDE.md must have specific sections
                if ! grep -q "## 🚨 Current Priority" "$file"; then
                    echo -e "${RED}❌ CLAUDE.md missing Current Priority section${NC}"
                    ((errors++))
                fi
                if ! grep -q "## 🚀 Session Management" "$file"; then
                    echo -e "${RED}❌ CLAUDE.md missing Session Management section${NC}"
                    ((errors++))
                fi
                ;;
                
                
            "documentation/api/"*.md)
                # API docs must have endpoint structure
                if ! grep -E "^### (GET|POST|PUT|DELETE|PATCH)" "$file"; then
                    echo -e "${YELLOW}⚠️  API documentation should include HTTP methods${NC}"
                fi
                ;;
                
            "documentation/architecture/ADR-"*.md)
                # ADRs must follow template
                if ! grep -q "## Status" "$file"; then
                    echo -e "${RED}❌ ADR missing Status section${NC}"
                    ((errors++))
                fi
                if ! grep -q "## Context" "$file"; then
                    echo -e "${RED}❌ ADR missing Context section${NC}"
                    ((errors++))
                fi
                if ! grep -q "## Decision" "$file"; then
                    echo -e "${RED}❌ ADR missing Decision section${NC}"
                    ((errors++))
                fi
                if ! grep -q "## Consequences" "$file"; then
                    echo -e "${RED}❌ ADR missing Consequences section${NC}"
                    ((errors++))
                fi
                ;;
        esac
    done
    
    return $errors
}

# Function to auto-generate documentation updates
suggest_updates() {
    local changed_files=$(git diff --cached --name-only --diff-filter=AM)
    
    # Check for new API routes
    if echo "$changed_files" | grep -E "routes\.(js|ts)$" >/dev/null; then
        echo -e "${BLUE}💡 New routes detected. Remember to update:${NC}"
        echo "   - documentation/api/ with endpoint documentation"
        echo "   - README.md API section if needed"
    fi
    
    # Check for new models/schemas
    if echo "$changed_files" | grep -E "(models?|schemas?)\.(js|ts)$" >/dev/null; then
        echo -e "${BLUE}💡 New models detected. Remember to update:${NC}"
        echo "   - documentation/database/ with schema documentation"
        echo "   - API documentation with request/response examples"
    fi
    
    # Check for new services
    if echo "$changed_files" | grep -E "services?\.(js|ts)$" >/dev/null; then
        echo -e "${BLUE}💡 New services detected. Remember to update:${NC}"
        echo "   - documentation/architecture/ with service descriptions"
        echo "   - CLAUDE.md if core architecture changed"
    fi
}

# Main execution
main() {
    echo -e "${BLUE}📚 FlowForge Documentation Pre-commit Check${NC}"
    echo "==========================================="
    
    # Check if documentation needs updating
    check_docs_need_update
    
    # Enforce documentation patterns
    local errors=0
    enforce_patterns
    errors=$?
    
    # Suggest updates based on changes
    suggest_updates
    
    # Run documentation validation if files changed
    if [ -f "$HOOK_DIR/check-documentation.sh" ]; then
        local doc_files=$(git diff --cached --name-only | grep -E "\.(md|MD)$" || true)
        if [ -n "$doc_files" ]; then
            echo ""
            bash "$HOOK_DIR/check-documentation.sh"
            errors=$((errors + $?))
        fi
    fi
    
    # Summary
    echo ""
    if [ $errors -eq 0 ]; then
        echo -e "${GREEN}✅ Documentation checks passed${NC}"
        return 0
    else
        echo -e "${RED}❌ Documentation errors found${NC}"
        echo -e "${RED}   Fix the errors above and try again${NC}"
        return 1
    fi
}

# Run if not sourced
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi