# Command: flowforge:wisdom:read
# Version: 2.0.0
# Description: FlowForge wisdom read command

# /read_from_wisdom

Read and display FlowForge wisdom documentation for context.

## Usage

```
/read_from_wisdom <topic>
```

Topic is required - specifies which wisdom document to read.

## Examples

```
/read_from_wisdom development-hooks    # Read about development hooks
/read_from_wisdom stripe              # Read Stripe integration guide
/read_from_wisdom github-milestones   # Read GitHub milestones guide
```

## Implementation

```bash
#!/bin/bash
# Read wisdom documentation with comprehensive error handling

# Help check FIRST before strict mode
if [[ "${1:-}" == "?" ]] || [[ "${1:-}" == "help" ]]; then
    echo "FlowForge Wisdom Reader"
    echo ""
    echo "USAGE:"
    echo "  /flowforge:wisdom:read <topic>"
    echo ""
    echo "DESCRIPTION:"
    echo "  Read and display FlowForge wisdom documentation for context."
    echo "  Topic is required - specifies which wisdom document to read."
    echo ""
    echo "EXAMPLES:"
    echo "  /flowforge:wisdom:read development-hooks    # Read about development hooks"
    echo "  /flowforge:wisdom:read stripe              # Read Stripe integration guide"
    echo "  /flowforge:wisdom:read github-milestones   # Read GitHub milestones guide"
    echo ""
    echo "OPTIONS:"
    echo "  ?, help    Show this help message"
    echo ""
    exit 0
fi

# Strict error handling
set -euo pipefail

# Enhanced error handling function
handle_error() {
    local line_number=$1
    local exit_code=$?
    local command="${BASH_COMMAND}"
    
    echo -e "\n${RED}❌ FlowForge Wisdom Read Error${NC}" >&2
    echo -e "${RED}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}" >&2
    echo -e "${YELLOW}Error Details:${NC}" >&2
    echo -e "  Command: ${command}" >&2
    echo -e "  Line: ${line_number}" >&2
    echo -e "  Exit Code: ${exit_code}" >&2
    
    if [[ "${DEBUG:-0}" == "1" ]]; then
        echo -e "\n${YELLOW}Debug Information:${NC}" >&2
        echo -e "  Wisdom Directory: ${WISDOM_DIR:-undefined}" >&2
        echo -e "  Topic: ${TOPIC:-undefined}" >&2
        echo -e "  Working Directory: $(pwd)" >&2
        echo -e "  User: $(whoami)" >&2
        echo -e "  Date: $(date)" >&2
    fi
    
    echo -e "\n${BLUE}💡 Troubleshooting Tips:${NC}" >&2
    echo -e "  • Run with DEBUG=1 for more detailed error information" >&2
    echo -e "  • Check if wisdom directory exists: .flowforge/documentation/wisdom" >&2
    echo -e "  • Verify file permissions for wisdom documents" >&2
    echo -e "  • Use '/flowforge:wisdom:read ?' for help" >&2
    echo -e "${RED}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}" >&2
    
    exit $exit_code
}

# Set error trap
trap 'handle_error $LINENO' ERR

WISDOM_DIR=".flowforge/documentation/wisdom"
TOPIC="${1:-}"

# Colors
BLUE='\033[0;34m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${BLUE}📚 FlowForge Wisdom Reader${NC}"
echo "────────────────────────────────"

# Function to find wisdom document
find_wisdom_doc() {
    local topic="$1"
    local found=""
    
    # Search in all categories
    for category in tools apis patterns debugging; do
        # Direct match
        if [ -f "$WISDOM_DIR/$category/${topic}.md" ]; then
            found="$WISDOM_DIR/$category/${topic}.md"
            break
        fi
        # Try with common suffixes
        for suffix in "-integration" "-api" "-guide" "-hooks"; do
            if [ -f "$WISDOM_DIR/$category/${topic}${suffix}.md" ]; then
                found="$WISDOM_DIR/$category/${topic}${suffix}.md"
                break 2
            fi
        done
    done
    
    echo "$found"
}

# Function to display document summary with error handling
show_document_summary() {
    local doc_path="$1"
    
    # Verify document exists and is readable
    if [[ ! -f "$doc_path" ]]; then
        echo -e "${RED}❌ Document file not found:${NC} $doc_path" >&2
        return 1
    fi
    
    if [[ ! -r "$doc_path" ]]; then
        echo -e "${RED}❌ Cannot read document:${NC} $doc_path" >&2
        return 1
    fi
    
    # Extract metadata with error handling
    local last_updated category version
    last_updated=$(grep -E "^\*\*Last Updated\*\*:" "$doc_path" 2>/dev/null | sed 's/.*: //' || echo "Unknown")
    version=$(grep -E "^\*\*Version\*\*:" "$doc_path" 2>/dev/null | sed 's/.*: //' || echo "Unknown") 
    category=$(grep -E "^\*\*Category\*\*:" "$doc_path" 2>/dev/null | sed 's/.*: //' || echo "Unknown")
    
    echo -e "\n${GREEN}📄 Document:${NC} $(basename "$doc_path")"
    echo -e "${GREEN}📁 Category:${NC} ${category}"
    echo -e "${GREEN}📅 Last Updated:${NC} ${last_updated}"
    echo -e "${GREEN}🏷️  Version:${NC} ${version}"
    
    # Extract executive summary with error handling
    echo -e "\n${BLUE}📋 Executive Summary:${NC}"
    local summary
    summary=$(sed -n '/^## Executive Summary/,/^##/p' "$doc_path" 2>/dev/null | grep -v "^##" | sed '/^$/d' || true)
    
    if [[ -n "$summary" ]]; then
        echo "$summary"
    else
        echo -e "${YELLOW}No executive summary found in this document.${NC}"
    fi
}

# Enhanced validation and error handling
if [ -z "$TOPIC" ]; then
    echo -e "${RED}❌ Error: Topic required${NC}" >&2
    echo -e "\n${YELLOW}Usage:${NC} /flowforge:wisdom:read <topic>" >&2
    echo -e "${YELLOW}Example:${NC} /flowforge:wisdom:read development-hooks" >&2
    
    # Check if wisdom directory exists
    if [[ ! -d "$WISDOM_DIR" ]]; then
        echo -e "\n${RED}⚠️  Wisdom directory does not exist:${NC} $WISDOM_DIR" >&2
        echo -e "${YELLOW}💡 This might be a new FlowForge installation. Run setup first.${NC}" >&2
        exit 1
    fi
    
    echo -e "\n${BLUE}Available wisdom topics:${NC}" >&2
    local topics_found=false
    
    # List available documents with enhanced error handling
    for category in tools apis patterns debugging; do
        if [[ -d "$WISDOM_DIR/$category" ]]; then
            # Check if directory is readable
            if [[ ! -r "$WISDOM_DIR/$category" ]]; then
                echo -e "${YELLOW}⚠️  Cannot read category directory:${NC} $category" >&2
                continue
            fi
            
            # Use safer approach to check for files
            local category_files
            category_files=$(find "$WISDOM_DIR/$category" -name "*.md" -type f 2>/dev/null || true)
            
            if [[ -n "$category_files" ]]; then
                echo -e "\n${YELLOW}${category^}:${NC}" >&2
                echo "$category_files" | while IFS= read -r file; do
                    if [[ -r "$file" ]]; then
                        basename "$file" .md | sed 's/^/  - /' >&2
                        topics_found=true
                    else
                        basename "$file" .md | sed 's/^/  - /' >&2
                        echo -e "    ${YELLOW}(unreadable)${NC}" >&2
                    fi
                done
            fi
        else
            [[ "${DEBUG:-0}" == "1" ]] && echo -e "${YELLOW}Debug: Category directory missing:${NC} $WISDOM_DIR/$category" >&2
        fi
    done
    
    if [[ "$topics_found" == false ]]; then
        echo -e "\n${YELLOW}No wisdom documents found. This might indicate:${NC}" >&2
        echo -e "  • FlowForge is not properly installed" >&2
        echo -e "  • Wisdom documents haven't been created yet" >&2
        echo -e "  • Permission issues with the wisdom directory" >&2
    fi
    
    exit 1
fi

# Find the document with enhanced error handling
DOC_PATH=$(find_wisdom_doc "$TOPIC")

if [[ -z "$DOC_PATH" ]] || [[ ! -f "$DOC_PATH" ]]; then
    echo -e "${RED}❌ Wisdom document not found:${NC} $TOPIC" >&2
    
    # Check if wisdom directory is accessible
    if [[ ! -d "$WISDOM_DIR" ]]; then
        echo -e "${RED}⚠️  Wisdom directory does not exist:${NC} $WISDOM_DIR" >&2
        echo -e "${YELLOW}💡 Run FlowForge setup to initialize wisdom documentation.${NC}" >&2
        exit 1
    fi
    
    if [[ ! -r "$WISDOM_DIR" ]]; then
        echo -e "${RED}⚠️  Cannot read wisdom directory:${NC} $WISDOM_DIR" >&2
        echo -e "${YELLOW}💡 Check directory permissions: chmod 755 $WISDOM_DIR${NC}" >&2
        exit 1
    fi
    
    # Suggest similar documents with error handling
    echo -e "\n${YELLOW}💡 Did you mean one of these?${NC}" >&2
    local similar_files
    similar_files=$(find "$WISDOM_DIR" -name "*${TOPIC}*.md" -type f 2>/dev/null || true)
    
    if [[ -n "$similar_files" ]]; then
        echo "$similar_files" | while IFS= read -r file; do
            if [[ -r "$file" ]]; then
                basename "$file" .md | sed 's/^/  - /' >&2
            else
                basename "$file" .md | sed 's/^/  - /' >&2
                echo -e "    ${YELLOW}(permission denied)${NC}" >&2
            fi
        done
    else
        # Show all available if no matches  
        echo -e "\n${BLUE}All available topics:${NC}" >&2
        local all_files
        all_files=$(find "$WISDOM_DIR" -name "*.md" -type f 2>/dev/null || true)
        
        if [[ -n "$all_files" ]]; then
            echo "$all_files" | while IFS= read -r file; do
                if [[ -r "$file" ]]; then
                    basename "$file" .md | sed 's/^/  - /' >&2
                else
                    basename "$file" .md | sed 's/^/  - /' >&2
                    echo -e "    ${YELLOW}(permission denied)${NC}" >&2
                fi
            done
        else
            echo -e "${YELLOW}No wisdom documents found in any category.${NC}" >&2
        fi
    fi
    exit 1
fi

# Verify document is readable
if [[ ! -r "$DOC_PATH" ]]; then
    echo -e "${RED}❌ Cannot read wisdom document:${NC} $DOC_PATH" >&2
    echo -e "${YELLOW}💡 Check file permissions: chmod 644 $DOC_PATH${NC}" >&2
    exit 1
fi

# Display document summary with error handling  
if ! show_document_summary "$DOC_PATH"; then
    echo -e "${RED}❌ Failed to display document summary${NC}" >&2
    exit 1
fi

# Show table of contents with error handling
echo -e "\n${BLUE}📑 Table of Contents:${NC}"
local toc
toc=$(grep "^##" "$DOC_PATH" 2>/dev/null | grep -v "^## Sources" | sed 's/^## /  • /' || true)

if [[ -n "$toc" ]]; then
    echo "$toc"
else
    echo -e "${YELLOW}No table of contents available.${NC}"
fi

# Display full document with error handling
echo -e "\n${BLUE}📖 Full Document:${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if ! cat "$DOC_PATH" 2>/dev/null; then
    echo -e "${RED}❌ Failed to read document content${NC}" >&2
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    exit 1
fi

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Success message
echo -e "\n${GREEN}✅ Wisdom loaded into context${NC}"
echo -e "${BLUE}💡 You can now use this knowledge in your work${NC}"

[[ "${DEBUG:-0}" == "1" ]] && echo -e "\n${YELLOW}Debug: Successfully processed wisdom document at $DOC_PATH${NC}" >&2
```

This command provides easy access to wisdom documentation, making institutional knowledge readily available during development.