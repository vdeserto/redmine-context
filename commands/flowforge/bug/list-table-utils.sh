#!/bin/bash
# Table display utilities for bug list command
# Extracted from list.md to comply with Rule #24 (700 line limit)

# Display bugs grouped by priority
display_grouped_table() {
    local COMBINED_DATA="$1"
    local USE_COLOR="$2"
    
    # Set up colors based on USE_COLOR setting
    if [ "$USE_COLOR" = "always" ]; then
        local RED='\033[0;31m'
        local YELLOW='\033[1;33m'
        local GREEN='\033[0;32m'
        local BLUE='\033[0;34m'
        local GRAY='\033[0;37m'
        local CYAN='\033[0;36m'
        local BOLD='\033[1m'
        local NC='\033[0m'
    else
        local RED='' YELLOW='' GREEN='' BLUE='' GRAY='' CYAN='' BOLD='' NC=''
    fi
    
    for PRIORITY in critical high medium low; do
        PRIORITY_BUGS=$(jq ".bugs | map(select(.priority == \"$PRIORITY\"))" "$COMBINED_DATA" 2>/dev/null)
        PRIORITY_COUNT=$(echo "$PRIORITY_BUGS" | jq 'length' 2>/dev/null || echo "0")
        
        if [ "$PRIORITY_COUNT" != "0" ]; then
            # Priority header with color
            PRIORITY_COLOR="$NC"
            PRIORITY_ICON="🐛"
            case "$PRIORITY" in
                critical) 
                    PRIORITY_COLOR="$RED"
                    PRIORITY_ICON="🔥"
                    ;;
                high) 
                    PRIORITY_COLOR="$YELLOW"
                    PRIORITY_ICON="⚠️"
                    ;;
                medium) 
                    PRIORITY_COLOR="$BLUE"
                    PRIORITY_ICON="🐛"
                    ;;
                low) 
                    PRIORITY_COLOR="$GREEN"
                    PRIORITY_ICON="💡"
                    ;;
            esac
            
            echo ""
            echo -e "${BOLD}$PRIORITY_COLOR$PRIORITY_ICON ${PRIORITY^^} PRIORITY ($PRIORITY_COUNT bugs)${NC}"
            echo "────────────────────────────────────────────────────"
            
            # Display bugs in this priority
            echo "$PRIORITY_BUGS" | jq -r '.[] | 
                (.github.number // .id | tostring) + " | " + 
                .title + " | " + 
                (.assignee // "unassigned") + " | " + 
                (.created | split("T")[0]) + " | " +
                (if .github.url then .github.url else "no-url" end)' | 
            while IFS='|' read -r ID TITLE ASSIGNEE CREATED URL; do
                # Trim spaces
                ID=$(echo "$ID" | xargs)
                TITLE=$(echo "$TITLE" | xargs)
                ASSIGNEE=$(echo "$ASSIGNEE" | xargs)
                CREATED=$(echo "$CREATED" | xargs)
                URL=$(echo "$URL" | xargs)
                
                # Format output with fixed widths
                printf "${PRIORITY_COLOR}#%-4s${NC} %-50s ${GRAY}%s${NC} ${CYAN}%s${NC}\n" \
                    "$ID" \
                    "$(echo "$TITLE" | cut -c1-50)" \
                    "$ASSIGNEE" \
                    "$CREATED"
                
                if [ "$URL" != "no-url" ] && [ -n "$URL" ]; then
                    printf "      ${GRAY}→ %s${NC}\n" "$URL"
                fi
            done
        fi
    done
}

# Display standard table format
display_standard_table() {
    local COMBINED_DATA="$1"
    local USE_COLOR="$2"
    
    # Set up colors based on USE_COLOR setting
    if [ "$USE_COLOR" = "always" ]; then
        local RED='\033[0;31m'
        local YELLOW='\033[1;33m'
        local GREEN='\033[0;32m'
        local BLUE='\033[0;34m'
        local GRAY='\033[0;37m'
        local CYAN='\033[0;36m'
        local BOLD='\033[1m'
        local NC='\033[0m'
    else
        local RED='' YELLOW='' GREEN='' BLUE='' GRAY='' CYAN='' BOLD='' NC=''
    fi
    
    printf "${BOLD}%-6s %-50s %-10s %-12s %-12s %s${NC}\n" "ID" "TITLE" "PRIORITY" "STATUS" "ASSIGNEE" "CREATED"
    echo "────────────────────────────────────────────────────────────────────────────────────────────────────"
    
    jq -r '.bugs[] | 
        [
            (.github.number // .id | tostring),
            .title,
            .priority,
            .status,
            (.assignee // "unassigned"),
            (.created | split("T")[0]),
            (.github.url // "")
        ] | @tsv' "$COMBINED_DATA" |
    while IFS=$'\t' read -r ID TITLE PRIORITY STATUS ASSIGNEE CREATED URL; do
        # Color coding based on priority
        PRIORITY_COLOR="$NC"
        case "$PRIORITY" in
            critical) PRIORITY_COLOR="$RED" ;;
            high) PRIORITY_COLOR="$YELLOW" ;;
            medium) PRIORITY_COLOR="$BLUE" ;;
            low) PRIORITY_COLOR="$GREEN" ;;
        esac
        
        # Status color
        STATUS_COLOR="$NC"
        case "$STATUS" in
            open) STATUS_COLOR="$GREEN" ;;
            closed) STATUS_COLOR="$GRAY" ;;
            in_progress) STATUS_COLOR="$YELLOW" ;;
        esac
        
        printf "${PRIORITY_COLOR}#%-5s${NC} %-50s ${PRIORITY_COLOR}%-10s${NC} ${STATUS_COLOR}%-12s${NC} ${CYAN}%-12s${NC} %s\n" \
            "$ID" \
            "$(echo "$TITLE" | cut -c1-50)" \
            "${PRIORITY^^}" \
            "${STATUS^^}" \
            "$ASSIGNEE" \
            "$CREATED"
            
        if [ -n "$URL" ]; then
            printf "      ${GRAY}→ %s${NC}\n" "$URL"
        fi
    done
}