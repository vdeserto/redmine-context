#!/bin/bash
# FlowForge Documentation Update Enforcement
# Blocks commits that change code without updating required documentation

set -euo pipefail

# Colors
RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

# Track if documentation updates are required
DOCS_REQUIRED=false
DOCS_UPDATED=false
REQUIRED_UPDATES=()

# Function to detect project type
detect_project_type() {
    # Check for ML/AI project indicators
    if [ -f "requirements.txt" ] && grep -qE "(torch|tensorflow|keras|scikit-learn|transformers|langchain|openai)" requirements.txt 2>/dev/null; then
        echo "ml"
        return
    fi
    
    if [ -f "pyproject.toml" ] && grep -qE "(torch|tensorflow|keras|scikit-learn|transformers)" pyproject.toml 2>/dev/null; then
        echo "ml"
        return
    fi
    
    # Check for API project indicators across languages
    # Python API frameworks
    if [ -f "requirements.txt" ] && grep -qE "(fastapi|flask|django-rest|tornado|aiohttp)" requirements.txt 2>/dev/null; then
        echo "api"
        return
    fi
    
    # Ruby API frameworks
    if [ -f "Gemfile" ] && grep -qE "(rails|sinatra|grape|hanami)" Gemfile 2>/dev/null; then
        echo "api"
        return
    fi
    
    # Node.js API frameworks
    if [ -f "package.json" ] && grep -qE "(express|koa|fastify|hapi|restify)" package.json 2>/dev/null; then
        echo "api"
        return
    fi
    
    # Check for API documentation files
    if [ -f "openapi.yaml" ] || [ -f "swagger.json" ] || [ -f "api.yaml" ] || [ -d "app/controllers" ] || [ -d "api" ]; then
        echo "api"
        return
    fi
    
    # Check for web/frontend project
    if [ -f "package.json" ] && grep -qE "(react|vue|angular|next|nuxt|gatsby|svelte)" package.json 2>/dev/null; then
        echo "web"
        return
    fi
    
    # Check for mobile project
    if [ -f "package.json" ] && grep -qE "(react-native|expo|ionic)" package.json 2>/dev/null; then
        echo "mobile"
        return
    fi
    
    # Default
    echo "general"
}

PROJECT_TYPE=$(detect_project_type)

# Function to check if file requires documentation update
requires_doc_update() {
    local file=$1
    
    # Skip test files themselves - they don't need test documentation
    if [[ "$file" =~ (test_|_test\.|\.test\.|\.spec\.|tests/|test/|__tests__/) ]]; then
        return 1
    fi
    
    # Skip scripts directory for ML projects
    if [[ "$PROJECT_TYPE" == "ml" ]] && [[ "$file" =~ ^scripts/ ]]; then
        return 1
    fi
    
    case "$file" in
        # API changes require API documentation
        *routes.*|*controller.*|*endpoint.*|*api.*)
            # Only require API docs for API projects
            if [[ "$PROJECT_TYPE" == "api" ]] || [[ "$PROJECT_TYPE" == "web" ]]; then
                REQUIRED_UPDATES+=("documentation/api/")
                return 0
            fi
            ;;
            
        # Database changes require schema documentation
        # More specific patterns for actual database models
        *models/*.entity.*|*entities/*|*models/*.model.*|*schema.*|*models.py)
            # Skip ML/AI model files in ML projects
            if [[ "$PROJECT_TYPE" == "ml" ]]; then
                # Only flag if it looks like a database model
                if [[ "$file" =~ (entity|schema|orm|db) ]]; then
                    REQUIRED_UPDATES+=("documentation/database/")
                    return 0
                fi
            else
                # For non-ML projects, be more strict about models
                REQUIRED_UPDATES+=("documentation/database/")
                return 0
            fi
            ;;
            
        *migrations/*|*migrate/*)
            REQUIRED_UPDATES+=("documentation/database/")
            REQUIRED_UPDATES+=("documentation/architecture/ADR-")
            return 0
            ;;
            
        # Service changes require architecture documentation
        *services/*|*service.*)
            REQUIRED_UPDATES+=("documentation/architecture/")
            return 0
            ;;
            
        # Config changes require documentation
        *.env.example|*config.*|.env.sample)
            REQUIRED_UPDATES+=("README.md")
            REQUIRED_UPDATES+=("documentation/")
            return 0
            ;;
            
        # Package changes require documentation
        package.json|requirements.txt|go.mod|Cargo.toml|Gemfile|pom.xml|pyproject.toml|Pipfile)
            REQUIRED_UPDATES+=("README.md")
            return 0
            ;;
            
        # Docker changes might need documentation
        Dockerfile|docker-compose*.yml|docker-compose*.yaml)
            REQUIRED_UPDATES+=("README.md")
            return 0
            ;;
    esac
    
    return 1
}

# Function to check if documentation was updated
check_doc_updates() {
    local staged_files=$(git diff --cached --name-only)
    
    # Check if any documentation files were updated
    if echo "$staged_files" | grep -E "\.(md|MD)$" >/dev/null; then
        DOCS_UPDATED=true
        
        # Check specific required documentation
        for required in "${REQUIRED_UPDATES[@]}"; do
            if echo "$staged_files" | grep -F "$required" >/dev/null; then
                return 0
            fi
        done
        
        # Documentation was updated but not the required ones
        return 1
    fi
    
    return 1
}

# Function to analyze changes and enforce documentation
analyze_changes() {
    local staged_files=$(git diff --cached --name-only --diff-filter=AM)
    local code_files=()
    
    # Analyze each staged file
    while IFS= read -r file; do
        # Skip documentation files
        if [[ "$file" =~ \.(md|MD)$ ]]; then
            continue
        fi
        
        # Check if this file requires documentation
        if requires_doc_update "$file"; then
            DOCS_REQUIRED=true
            code_files+=("$file")
        fi
    done <<< "$staged_files"
    
    # Remove duplicates from required updates
    REQUIRED_UPDATES=($(printf "%s\n" "${REQUIRED_UPDATES[@]}" | sort -u))
    
    return 0
}

# Function to check commit message for doc exemption
check_commit_exemption() {
    local commit_msg_file=$1
    
    # Allow commits with [skip-docs] or [no-docs] in message
    if grep -E "\[(skip-docs|no-docs)\]" "$commit_msg_file" >/dev/null 2>&1; then
        echo -e "${YELLOW}⚠️  Documentation check skipped (exemption in commit message)${NC}"
        return 0
    fi
    
    return 1
}

# Main enforcement function
enforce_documentation() {
    echo -e "${BLUE}📚 FlowForge Documentation Enforcement${NC}"
    echo "======================================"
    
    # Analyze staged changes
    analyze_changes
    
    # If no documentation required, pass
    if [ "$DOCS_REQUIRED" = false ]; then
        echo -e "${GREEN}✅ No documentation updates required${NC}"
        return 0
    fi
    
    # Check if documentation was updated
    if check_doc_updates; then
        echo -e "${GREEN}✅ Required documentation updated${NC}"
        return 0
    fi
    
    # Documentation required but not updated
    echo -e "${RED}❌ BLOCKED: Documentation update required${NC}"
    echo ""
    echo -e "${RED}You've changed files that require documentation updates:${NC}"
    echo ""
    
    # List required documentation
    echo -e "${YELLOW}Required documentation updates:${NC}"
    for doc in "${REQUIRED_UPDATES[@]}"; do
        echo -e "  - $doc"
    done
    
    echo ""
    echo -e "${BLUE}Suggestions:${NC}"
    
    # Provide specific suggestions
    if [[ " ${REQUIRED_UPDATES[@]} " =~ " documentation/api/ " ]]; then
        echo "  📝 Update API documentation for new/changed endpoints"
        echo "     Example: documentation/api/endpoints.md"
    fi
    
    if [[ " ${REQUIRED_UPDATES[@]} " =~ " documentation/database/ " ]]; then
        echo "  📝 Update database schema documentation"
        echo "     Example: documentation/database/schema.md"
    fi
    
    if [[ " ${REQUIRED_UPDATES[@]} " =~ " documentation/architecture/ " ]]; then
        echo "  📝 Update architecture documentation or create an ADR"
        echo "     Example: documentation/architecture/ADR-XXXX-change-description.md"
    fi
    
    if [[ " ${REQUIRED_UPDATES[@]} " =~ " README.md " ]]; then
        echo "  📝 Update README.md with new dependencies or configuration"
    fi
    
    echo ""
    echo -e "${YELLOW}To bypass (use sparingly):${NC}"
    echo "  Add [skip-docs] to your commit message"
    echo ""
    echo -e "${RED}Commit blocked. Update documentation and try again.${NC}"
    
    return 1
}

# Hook integration function
integrate_with_commit() {
    local commit_msg_file=${1:-}
    
    # Check for exemption if commit message provided
    if [ -n "$commit_msg_file" ] && [ -f "$commit_msg_file" ]; then
        if check_commit_exemption "$commit_msg_file"; then
            return 0
        fi
    fi
    
    # Enforce documentation
    enforce_documentation
}

# Main execution
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    integrate_with_commit "$@"
fi