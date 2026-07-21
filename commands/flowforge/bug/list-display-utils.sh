#!/bin/bash
# list-display-utils.sh - Display and output utilities for bug list command
# Additional utilities to comply with Rule #24 (700 line limit)

# Generate table output for bugs
generate_table_output() {
    local combined_data="$1"
    local group_field="$2"
    local final_bug_count="$3"
    local color_codes="$4"
    
    # Parse color codes
    local RED=$(echo "$color_codes" | cut -d'|' -f1)
    local YELLOW=$(echo "$color_codes" | cut -d'|' -f2)
    local BLUE=$(echo "$color_codes" | cut -d'|' -f3)
    local GREEN=$(echo "$color_codes" | cut -d'|' -f4)
    local GRAY=$(echo "$color_codes" | cut -d'|' -f5)
    local CYAN=$(echo "$color_codes" | cut -d'|' -f6)
    local BOLD=$(echo "$color_codes" | cut -d'|' -f7)
    local NC=$(echo "$color_codes" | cut -d'|' -f8)
    
    echo ""
    echo "════════════════════════════════════════════════════"
    echo -e "${BOLD}🐛 BUG LIST - $final_bug_count RESULTS${NC}"
    echo "════════════════════════════════════════════════════"
    
    # Group output if requested
    if [ "$group_field" = "priority" ]; then
        for PRIORITY in critical high medium low; do
            format_priority_table "$combined_data" "$PRIORITY" "$color_codes"
        done
    else
        # Standard table format
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
            ] | @tsv' "$combined_data" |
        while IFS=$'\t' read -r ID TITLE PRIORITY STATUS ASSIGNEE CREATED URL; do
            # Color coding based on priority
            local PRIORITY_COLOR="$NC"
            case "$PRIORITY" in
                critical) PRIORITY_COLOR="$RED" ;;
                high) PRIORITY_COLOR="$YELLOW" ;;
                medium) PRIORITY_COLOR="$BLUE" ;;
                low) PRIORITY_COLOR="$GREEN" ;;
            esac
            
            # Status color
            local STATUS_COLOR="$NC"
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
                
            [ -n "$URL" ] && printf "      ${GRAY}→ %s${NC}\n" "$URL"
        done
    fi
    
    # Summary statistics
    echo ""
    echo "────────────────────────────────────────────────────"
    echo -e "${BOLD}📊 SUMMARY STATISTICS${NC}"
    echo ""
    
    for PRIORITY in critical high medium low; do
        COUNT=$(jq ".bugs | map(select(.priority == \"$PRIORITY\")) | length" "$combined_data" 2>/dev/null || echo "0")
        if [ "$COUNT" != "0" ]; then
            local PRIORITY_COLOR="$NC"
            case "$PRIORITY" in
                critical) PRIORITY_COLOR="$RED" ;;
                high) PRIORITY_COLOR="$YELLOW" ;;
                medium) PRIORITY_COLOR="$BLUE" ;;
                low) PRIORITY_COLOR="$GREEN" ;;
            esac
            printf "${PRIORITY_COLOR}%-8s${NC}: %d bugs\n" "${PRIORITY^}" "$COUNT"
        fi
    done
    
    # Show next actions for critical bugs
    CRITICAL_COUNT=$(jq '.bugs | map(select(.priority == "critical")) | length' "$combined_data" 2>/dev/null || echo "0")
    if [ "$CRITICAL_COUNT" != "0" ]; then
        echo ""
        echo -e "${RED}⚠️  $CRITICAL_COUNT CRITICAL BUGS NEED IMMEDIATE ATTENTION${NC}"
        echo ""
        echo "Next actions:"
        echo "• Fix immediately: /flowforge:bug:nobugbehind [id] critical"
        echo "• Assign resources: gh issue edit [id] --assignee [user]"
        echo "• Escalate if needed: Consider hotfix deployment"
    fi
}

# Display available actions and commands
show_available_actions() {
    echo "🔧 Available Actions:"
    echo "• Fix bug: /flowforge:bug:nobugbehind [id]"
    echo "• Add bug: /flowforge:bug:add"
    echo "• View details: gh issue view [id]"
    echo "• Close bug: gh issue close [id]"
    echo ""
    
    echo "📋 Useful Filters:"
    echo "• My bugs: /flowforge:bug:list --assignee=me"
    echo "• Critical only: /flowforge:bug:list critical"
    echo "• Recent bugs: /flowforge:bug:list --since=\"1 week ago\""
    echo "• Search: /flowforge:bug:list --search=\"keyword\""
    echo ""
    
    echo "🔄 Batch Operations:"
    echo "• Close all low priority: /flowforge:bug:list --priority=low --batch-close"
    echo "• Assign critical bugs: /flowforge:bug:list --priority=critical --batch-assign=username"
    echo "• Change old bugs priority: /flowforge:bug:list --since=\"30 days ago\" --batch-priority=low"
    echo "• Update status: /flowforge:bug:list --status=open --batch-status=in_progress"
    echo ""
    
    echo "📤 Export Options:"
    echo "• CSV export: /flowforge:bug:list --format=csv --export=bugs.csv"
    echo "• Markdown report: /flowforge:bug:list --format=markdown --export=report.md"
    echo "• JSON data: /flowforge:bug:list --format=json --export=bugs.json"
}

# Load bug data from multiple sources
load_bug_data() {
    local combined_data="$1"
    local limit="$2"
    local status_filter="$3"
    local assignee_filter="$4"
    local search_filter="$5"
    shift 5
    local temp_files=("$@")
    
    echo '{"bugs": []}' > "$combined_data"
    
    local bugs_loaded=0
    local sources_loaded=()
    
    # Load from FlowForge backlog
    if [ -f ".flowforge/bug-backlog.json" ]; then
        echo "📋 Loading from local bug backlog..."
        if command -v jq >/dev/null 2>&1; then
            if BACKLOG_BUGS=$(jq -r '.bugs[]' .flowforge/bug-backlog.json 2>/dev/null); then
                local temp_merge="/tmp/flowforge_merge_$$.json"
                temp_files+=("$temp_merge")
                jq -s '.[0].bugs += .[1].bugs | .[0]' "$combined_data" ".flowforge/bug-backlog.json" > "$temp_merge" 2>/dev/null && mv "$temp_merge" "$combined_data"
                local local_count=$(jq '.bugs | length' "$combined_data" 2>/dev/null || echo "0")
                echo "✅ Loaded $local_count bugs from local backlog"
                bugs_loaded=$((bugs_loaded + local_count))
                sources_loaded+=("local")
            fi
        else
            echo "⚠️  jq not available - cannot load JSON backlog"
        fi
    fi
    
    # Load from GitHub Issues  
    if command -v gh &> /dev/null; then
        echo "🐙 Loading from GitHub Issues..."
        
        # Build GitHub query based on filters
        local gh_query="is:issue"
        
        if [ -n "$status_filter" ]; then
            case "$status_filter" in
                open) gh_query+=" is:open" ;;
                closed) gh_query+=" is:closed" ;;
            esac
        fi
        
        if [ -n "$assignee_filter" ]; then
            if [ "$assignee_filter" = "me" ]; then
                gh_query+=" assignee:@me"
            else
                gh_query+=" assignee:$assignee_filter"
            fi
        fi
        
        [ -n "$search_filter" ] && gh_query+=" $search_filter"
        gh_query+=" label:bug"
        
        echo "🔍 GitHub query: $gh_query"
        
        # Fetch issues from GitHub
        if GH_ISSUES=$(gh issue list --search "$gh_query" --limit "$limit" --json number,title,state,labels,assignees,createdAt,updatedAt,url,body 2>/dev/null); then
            local temp_gh="/tmp/flowforge_gh_$$.json"
            temp_files+=("$temp_gh")
            
            echo "$GH_ISSUES" | jq '
            {
                "bugs": map({
                    "id": .number,
                    "title": .title,
                    "priority": (
                        if (.labels | map(.name) | contains(["critical"])) then "critical"
                        elif (.labels | map(.name) | contains(["high"])) then "high"
                        elif (.labels | map(.name) | contains(["low"])) then "low"
                        else "medium"
                        end
                    ),
                    "description": .body,
                    "tags": [.labels[] | .name],
                    "context": {
                        "task": null,
                        "branch": null,
                        "files": [],
                        "commit": null
                    },
                    "github": {
                        "url": .url,
                        "number": .number
                    },
                    "created": .createdAt,
                    "updated": .updatedAt,
                    "status": (if .state == "open" then "open" else "closed" end),
                    "assignee": (if .assignees | length > 0 then .assignees[0].login else null end),
                    "source": "github"
                })
            }' > "$temp_gh" 2>/dev/null
            
            if [ -s "$temp_gh" ]; then
                local temp_merge="/tmp/flowforge_merge_gh_$$.json"
                temp_files+=("$temp_merge")
                jq -s '.[0].bugs += .[1].bugs | .[0]' "$combined_data" "$temp_gh" > "$temp_merge" 2>/dev/null && mv "$temp_merge" "$combined_data"
                local gh_count=$(jq '.bugs | map(select(.source == "github")) | length' "$combined_data" 2>/dev/null || echo "0")
                echo "✅ Loaded $gh_count issues from GitHub"
                sources_loaded+=("github")
            fi
        else
            echo "⚠️  Could not load GitHub issues (check authentication)"
        fi
    else
        echo "⚠️  GitHub CLI not available - skipping GitHub issues"
    fi
    
    # Remove duplicates
    if command -v jq >/dev/null 2>&1; then
        local temp_dedup="/tmp/flowforge_dedup_$$.json"
        temp_files+=("$temp_dedup")
        
        jq '.bugs |= (
            group_by(.github.number // .id) |
            map(
                if length > 1 then
                    sort_by(.source != "github") | .[0]
                else
                    .[0]
                end
            )
        )' "$combined_data" > "$temp_dedup" 2>/dev/null && mv "$temp_dedup" "$combined_data"
        
        local final_count=$(jq '.bugs | length' "$combined_data" 2>/dev/null || echo "0")
        echo "✅ Final bug count: $final_count (after deduplication)"
    fi
    
    echo "📊 Data sources: ${sources_loaded[*]:-none}"
}