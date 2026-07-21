# Command: flowforge:wisdom:update
# Version: 2.0.0
# Description: FlowForge wisdom update command

# /update-wisdom-docs

Update FlowForge wisdom documentation from external sources.

## Usage

```
/update-wisdom-docs [topic]
```

- Without parameter: Lists available wisdom documents to update
- With parameter: Updates specific wisdom document

## Examples

```
/update-wisdom-docs                    # Show all wisdom docs
/update-wisdom-docs claude-code-hooks  # Update specific doc
/update-wisdom-docs stripe             # Update Stripe integration doc
```

## Implementation

```bash
#!/bin/bash
# Update wisdom documentation

WISDOM_DIR=".flowforge/documentation/wisdom"
TOPIC="${1:-}"

# Colors
BLUE='\033[0;34m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

# Error handling function
handle_error() {
    local error_message="$1"
    local exit_code="${2:-1}"
    echo -e "${RED}❌ Error:${NC} $error_message" >&2
    exit "$exit_code"
}

# Help function
show_help() {
    echo -e "${BLUE}📚 FlowForge Wisdom Update System${NC}"
    echo "────────────────────────────────"
    echo ""
    echo -e "${BLUE}Purpose:${NC} Update FlowForge wisdom documentation from external sources"
    echo ""
    echo -e "${BLUE}Usage:${NC}"
    echo "  /flowforge:wisdom:update [topic]"
    echo "  /flowforge:wisdom:update ? | help    # Show this help"
    echo ""
    echo -e "${BLUE}Parameters:${NC}"
    echo "  topic    Optional. Specific wisdom document to update"
    echo "           Without topic: Lists all available wisdom documents"
    echo ""
    echo -e "${BLUE}Examples:${NC}"
    echo "  /flowforge:wisdom:update                    # Show all wisdom docs"
    echo "  /flowforge:wisdom:update claude-code-hooks  # Update specific doc"
    echo "  /flowforge:wisdom:update stripe             # Update Stripe integration doc"
    echo ""
    echo -e "${BLUE}Features:${NC}"
    echo "  • Lists available wisdom documents by category"
    echo "  • Finds documents with fuzzy matching (suffixes: -integration, -api)"
    echo "  • Shows document metadata and sources"
    echo "  • Provides next steps for updating"
    echo "  • Non-interactive mode for testing (FLOWFORGE_TEST=1)"
    echo ""
    echo -e "${BLUE}Error Handling:${NC}"
    echo "  • Missing wisdom directory detection"
    echo "  • Invalid topic argument validation"
    echo "  • File permission checking"
    echo "  • Malformed document handling"
    exit 0
}

# Check for help requests
if [[ "$TOPIC" == "?" || "$TOPIC" == "help" || "$TOPIC" == "--help" || "$TOPIC" == "-h" ]]; then
    show_help
fi

# Validate environment
if [[ ! -d ".flowforge" ]]; then
    handle_error "Not in a FlowForge project directory. Missing .flowforge directory." 2
fi

# Check if wisdom directory exists
if [[ ! -d "$WISDOM_DIR" ]]; then
    handle_error "Wisdom directory not found: $WISDOM_DIR
Please ensure FlowForge is properly initialized with wisdom documentation." 3
fi

echo -e "${BLUE}📚 FlowForge Wisdom Update System${NC}"
echo "────────────────────────────────"

# Function to list wisdom documents
list_wisdom_docs() {
    echo -e "\n${BLUE}Available wisdom documents:${NC}"
    
    local doc_found=false
    
    # Check each category and handle errors
    for category in tools apis patterns debugging; do
        local category_dir="$WISDOM_DIR/$category"
        
        if [[ -d "$category_dir" ]]; then
            # Check if we have read permissions
            if [[ ! -r "$category_dir" ]]; then
                echo -e "${YELLOW}⚠️  Cannot access $category directory (permission denied)${NC}"
                continue
            fi
            
            # Find markdown files
            local files
            files=$(find "$category_dir" -name "*.md" -type f 2>/dev/null)
            
            if [[ -n "$files" ]]; then
                echo -e "\n${YELLOW}$(echo "$category" | sed 's/.*/\u&/'):${NC}"
                echo "$files" | while read -r file; do
                    if [[ -r "$file" ]]; then
                        basename "$file" .md | sed 's/^/  - /'
                    else
                        echo -e "  - ${RED}$(basename "$file" .md) (unreadable)${NC}"
                    fi
                done
                doc_found=true
            fi
        fi
    done
    
    if [[ "$doc_found" == "false" ]]; then
        echo -e "\n${YELLOW}⚠️  No wisdom documents found in any category.${NC}"
        echo -e "${YELLOW}💡 Try running: /flowforge:project:setup to initialize wisdom documentation${NC}"
    fi
}

# Function to validate topic input
validate_topic() {
    local topic="$1"
    
    # Check for empty topic
    if [[ -z "$topic" ]]; then
        return 1
    fi
    
    # Check for potentially dangerous characters
    if [[ "$topic" =~ [[:space:]] ]]; then
        echo -e "${YELLOW}⚠️  Topic contains spaces. Using first word only: $(echo "$topic" | awk '{print $1}')${NC}"
        topic=$(echo "$topic" | awk '{print $1}')
    fi
    
    # Remove potentially dangerous characters
    topic=$(echo "$topic" | tr -d '|;&$(){}[]<>?*\\`"'"'"'')
    
    # Check length
    if [[ ${#topic} -gt 50 ]]; then
        handle_error "Topic name too long (max 50 characters): $topic"
    fi
    
    # Check for valid characters (alphanumeric, hyphens, underscores only)
    if [[ ! "$topic" =~ ^[a-zA-Z0-9_-]+$ ]]; then
        handle_error "Invalid topic name. Use only alphanumeric characters, hyphens, and underscores: $topic"
    fi
    
    echo "$topic"
}

# Function to find wisdom document
find_wisdom_doc() {
    local topic="$1"
    local found=""
    
    # Validate topic first
    topic=$(validate_topic "$topic")
    if [[ -z "$topic" ]]; then
        return 1
    fi
    
    # Search in all categories with error handling
    for category in tools apis patterns debugging; do
        local category_dir="$WISDOM_DIR/$category"
        
        # Skip if category directory doesn't exist or isn't readable
        if [[ ! -d "$category_dir" ]] || [[ ! -r "$category_dir" ]]; then
            continue
        fi
        
        # Try exact match first
        local doc_path="$category_dir/${topic}.md"
        if [[ -f "$doc_path" ]] && [[ -r "$doc_path" ]]; then
            found="$doc_path"
            break
        fi
        
        # Try with common suffixes
        for suffix in "-integration" "-api" "-docs" "-guide"; do
            doc_path="$category_dir/${topic}${suffix}.md"
            if [[ -f "$doc_path" ]] && [[ -r "$doc_path" ]]; then
                found="$doc_path"
                break 2
            fi
        done
    done
    
    echo "$found"
}

# Function to validate and process document
process_wisdom_document() {
    local doc_path="$1"
    local topic="$2"
    
    # Verify file is readable
    if [[ ! -r "$doc_path" ]]; then
        handle_error "Cannot read wisdom document: $doc_path (permission denied)"
    fi
    
    # Check if file is not empty
    if [[ ! -s "$doc_path" ]]; then
        handle_error "Wisdom document is empty: $doc_path"
    fi
    
    # Basic file content validation
    if ! head -1 "$doc_path" | grep -q "^#"; then
        echo -e "${YELLOW}⚠️  Document may be malformed (no markdown header found)${NC}"
    fi
    
    echo -e "\n${BLUE}📄 Found document:${NC} $doc_path"
    
    # Get last updated date with error handling
    local last_updated
    last_updated=$(grep -E "^\*\*Last Updated\*\*:" "$doc_path" 2>/dev/null | sed 's/.*: //' || echo "Unknown")
    echo -e "${BLUE}📅 Last updated:${NC} $last_updated"
    
    # Extract sources section with error handling
    echo -e "\n${BLUE}🔍 Sources to check:${NC}"
    local sources
    sources=$(sed -n '/^## Sources/,/^##\|^$/p' "$doc_path" 2>/dev/null | grep -E "^- " | sed 's/^- /  /' || echo "  No sources found")
    
    if [[ "$sources" == "  No sources found" ]]; then
        echo -e "${YELLOW}⚠️  No sources section found in document${NC}"
        echo -e "${YELLOW}💡 Consider adding a '## Sources' section with relevant URLs${NC}"
    else
        echo "$sources"
    fi
    
    # Non-interactive mode check
    if [[ "$FLOWFORGE_TEST" == "1" ]]; then
        echo -e "\n${YELLOW}🧪 Running in test mode - skipping interactive prompts${NC}"
    fi
    
    # Inform user about next steps
    echo -e "\n${YELLOW}📋 Next steps:${NC}"
    echo "1. Use multi-agents to visit the source URLs"
    echo "2. Check for any updates or changes"
    echo "3. Update the wisdom document with new information"
    echo "4. Update the 'Last Updated' timestamp"
    echo "5. Add any new sources discovered"
    
    echo -e "\n${GREEN}✅ Ready to update:${NC} $topic"
    echo -e "${BLUE}💡 Claude will now use multi-agents to update this document${NC}"
}

# Main logic
if [[ -z "$TOPIC" ]]; then
    # No topic specified, list available documents
    list_wisdom_docs
    echo -e "\n${BLUE}Usage:${NC} /flowforge:wisdom:update <topic>"
    echo -e "${BLUE}Help:${NC} /flowforge:wisdom:update ? | help"
    echo -e "${BLUE}Example:${NC} /flowforge:wisdom:update claude-code-hooks"
else
    # Find the document with error handling
    DOC_PATH=$(find_wisdom_doc "$TOPIC")
    
    if [[ -z "$DOC_PATH" ]]; then
        echo -e "${RED}❌ Wisdom document not found:${NC} $TOPIC"
        echo -e "${YELLOW}💡 Available documents:${NC}"
        list_wisdom_docs
        echo -e "\n${YELLOW}💡 Tips:${NC}"
        echo "  • Check spelling and use hyphens instead of spaces"
        echo "  • Try common suffixes: -integration, -api, -docs, -guide"
        echo "  • Use /flowforge:wisdom:update without arguments to see all available topics"
        exit 1
    fi
    
    if [[ ! -f "$DOC_PATH" ]]; then
        handle_error "Wisdom document path exists but file not found: $DOC_PATH"
    fi
    
    # Process the document
    process_wisdom_document "$DOC_PATH" "$TOPIC"
fi
```

When this command is invoked, I will:
1. Identify the wisdom document to update
2. Use multi-agents to visit source URLs
3. Compare current content with latest information
4. Update the document with changes
5. Update timestamp and version
6. Report what was updated

This ensures our wisdom stays current with external changes.