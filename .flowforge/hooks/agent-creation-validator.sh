#!/bin/bash
# hooks/agent-creation-validator.sh
# FlowForge Agent Creation Validation Hook
# Ensures all new agents follow mandatory standards

set -euo pipefail

# Configuration
AGENTS_DIR="agents"
HOOK_NAME="agent-creation-validator"
REQUIRED_FIELDS=("name" "description")
OPTIONAL_FIELDS=("tools" "model")

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

# Validation functions
validate_yaml_frontmatter() {
    local file="$1"
    local temp_yaml="/tmp/agent_frontmatter.yaml"
    
    # Extract YAML frontmatter
    if ! head -n 20 "$file" | grep -q "^---$"; then
        log_error "Missing YAML frontmatter in $file"
        return 1
    fi
    
    # Extract and validate YAML
    sed -n '/^---$/,/^---$/p' "$file" | sed '1d;$d' > "$temp_yaml"
    
    # Check if YAML is valid
    if ! python3 -c "import yaml; yaml.safe_load(open('$temp_yaml'))" 2>/dev/null; then
        log_error "Invalid YAML frontmatter in $file"
        rm -f "$temp_yaml"
        return 1
    fi
    
    rm -f "$temp_yaml"
    return 0
}

validate_required_fields() {
    local file="$1"
    local missing_fields=()
    
    for field in "${REQUIRED_FIELDS[@]}"; do
        if ! grep -q "^${field}:" "$file"; then
            missing_fields+=("$field")
        fi
    done
    
    if [ ${#missing_fields[@]} -gt 0 ]; then
        log_error "Missing required fields in $file: ${missing_fields[*]}"
        return 1
    fi
    
    return 0
}

validate_naming_convention() {
    local file="$1"
    local filename=$(basename "$file" .md)
    
    # Check fft- prefix
    if [[ ! "$filename" =~ ^fft- ]]; then
        log_error "Agent filename must start with 'fft-': $filename"
        return 1
    fi
    
    # Check lowercase with hyphens
    if [[ ! "$filename" =~ ^[a-z0-9-]+$ ]]; then
        log_error "Agent filename must be lowercase with hyphens only: $filename"
        return 1
    fi
    
    # Validate name field matches filename
    local yaml_name=$(grep "^name:" "$file" | cut -d: -f2 | xargs)
    if [ "$yaml_name" != "$filename" ]; then
        log_error "YAML name field '$yaml_name' doesn't match filename '$filename'"
        return 1
    fi
    
    return 0
}

validate_description_requirements() {
    local file="$1"
    local description=$(sed -n '/^description:/,/^[a-zA-Z]/p' "$file" | sed '$d' | tail -n +2)
    
    # Check minimum length
    if [ ${#description} -lt 50 ]; then
        log_warning "Description in $file is too short (minimum 50 characters)"
    fi
    
    # Check for "proactively" keyword where appropriate
    if [[ "$description" =~ (optimization|improvement|analysis|review) ]] && [[ ! "$description" =~ proactively ]]; then
        log_warning "Consider adding 'proactively' to description in $file for improvement-focused agents"
    fi
    
    return 0
}

validate_header_template() {
    local file="$1"
    
    # Check for required header structure
    if ! grep -q "ALWAYS start your response by outputting this header" "$file"; then
        log_error "Missing header template instruction in $file"
        return 1
    fi
    
    # Check for color span tag
    if ! grep -q '<span style="color:' "$file"; then
        log_error "Missing colored header span in $file"
        return 1
    fi
    
    return 0
}

validate_flowforge_integration() {
    local file="$1"
    
    # Check for FlowForge rules reference
    if ! grep -q -i "flowforge rule" "$file"; then
        log_warning "Consider referencing relevant FlowForge rules in $file"
    fi
    
    # Check for success metrics
    if ! grep -q -i "success metrics\|metrics\|measure" "$file"; then
        log_warning "Consider adding success metrics section to $file"
    fi
    
    return 0
}

# Main validation function
validate_agent() {
    local file="$1"
    local errors=0
    local warnings=0
    
    log_info "Validating agent: $(basename "$file")"
    
    # Required validations
    if ! validate_yaml_frontmatter "$file"; then
        ((errors++))
    fi
    
    if ! validate_required_fields "$file"; then
        ((errors++))
    fi
    
    if ! validate_naming_convention "$file"; then
        ((errors++))
    fi
    
    if ! validate_header_template "$file"; then
        ((errors++))
    fi
    
    # Optional validations (warnings only)
    if ! validate_description_requirements "$file"; then
        ((warnings++))
    fi
    
    if ! validate_flowforge_integration "$file"; then
        ((warnings++))
    fi
    
    if [ $errors -gt 0 ]; then
        log_error "Agent validation failed: $errors errors"
        return 1
    elif [ $warnings -gt 0 ]; then
        log_warning "Agent validation passed with $warnings warnings"
        return 0
    else
        log_success "Agent validation passed successfully"
        return 0
    fi
}

# Update agent registry
update_registry() {
    local agent_file="$1"
    local registry_file="$AGENTS_DIR/.registry.json"
    local agent_name=$(basename "$agent_file" .md)
    
    log_info "Updating agent registry for $agent_name"
    
    # Extract agent metadata
    local display_name=$(grep "^name:" "$agent_file" | cut -d: -f2 | xargs)
    local description=$(sed -n '/^description:/,/^[a-zA-Z]/p' "$agent_file" | sed '$d' | tail -n +2 | tr -d '\n' | xargs)
    local current_date=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
    
    # Update registry using Python for JSON manipulation
    python3 << EOF
import json
import sys
from datetime import datetime

registry_file = "$registry_file"
agent_name = "$agent_name"
display_name = "$display_name"
description = "$description"
current_date = "$current_date"

try:
    with open(registry_file, 'r') as f:
        registry = json.load(f)
except FileNotFoundError:
    registry = {
        "version": "2.0.0",
        "updated": current_date,
        "agents": {},
        "installation": {
            "auto_install": True,
            "install_on_update": True,
            "check_updates": True,
            "update_frequency": "weekly"
        }
    }

# Update agent entry
registry["agents"][agent_name] = {
    "name": display_name,
    "version": "2.0.0",
    "description": description,
    "file": f"{agent_name}.md",
    "status": "active",
    "dependencies": [],
    "added": registry["agents"].get(agent_name, {}).get("added", current_date[:10]),
    "updated": current_date[:10]
}

registry["updated"] = current_date

with open(registry_file, 'w') as f:
    json.dump(registry, f, indent=2)

print(f"Registry updated for {agent_name}")
EOF
    
    log_success "Registry updated successfully"
}

# Main execution
main() {
    local validation_failed=0
    
    echo "🤖 FlowForge Agent Creation Validator"
    echo "===================================="
    
    # Find all agent files
    if [ ! -d "$AGENTS_DIR" ]; then
        log_error "Agents directory not found: $AGENTS_DIR"
        exit 1
    fi
    
    # Check for new or modified agent files
    local agent_files=()
    if [ "${1:-}" = "--all" ]; then
        # Validate all agents
        mapfile -t agent_files < <(find "$AGENTS_DIR" -name "fft-*.md" -type f)
    else
        # Validate only staged agent files
        mapfile -t agent_files < <(git diff --cached --name-only --diff-filter=AM | grep "^${AGENTS_DIR}/fft-.*\.md$" || true)
    fi
    
    if [ ${#agent_files[@]} -eq 0 ]; then
        log_info "No agent files to validate"
        exit 0
    fi
    
    log_info "Found ${#agent_files[@]} agent file(s) to validate"
    
    # Validate each agent
    for agent_file in "${agent_files[@]}"; do
        if [ -f "$agent_file" ]; then
            if ! validate_agent "$agent_file"; then
                validation_failed=1
            else
                # Update registry for valid agents
                update_registry "$agent_file"
            fi
            echo ""
        fi
    done
    
    # Summary
    if [ $validation_failed -eq 1 ]; then
        log_error "Agent validation failed. Please fix errors before committing."
        exit 1
    else
        log_success "All agent validations passed!"
        exit 0
    fi
}

# Run main function with all arguments
main "$@"