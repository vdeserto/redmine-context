#!/bin/bash
# list-utils.sh - Utility functions for bug list command
# Extracted to comply with Rule #24 (700 line limit)

# Batch operation functions
process_batch_close() {
    local combined_data="$1"
    local batch_success=0
    local batch_failed=0
    
    jq -r '.bugs[] | @json' "$combined_data" | while IFS= read -r bug_json; do
        local bug_id=$(echo "$bug_json" | jq -r '.github.number // .id')
        local bug_source=$(echo "$bug_json" | jq -r '.source // "local"')
        
        if [ "$bug_source" = "github" ]; then
            if gh issue close "$bug_id" 2>/dev/null; then
                echo "✅ Closed GitHub issue #$bug_id"
                ((batch_success++))
            else
                echo "❌ Failed to close GitHub issue #$bug_id"
                ((batch_failed++))
            fi
        else
            if [ -f ".flowforge/bug-backlog.json" ]; then
                local temp_update="/tmp/flowforge_batch_update_$$.json"
                jq --arg id "$bug_id" '.bugs |= map(if (.id == $id or .id == ($id | tonumber)) then .status = "closed" else . end)' ".flowforge/bug-backlog.json" > "$temp_update" && mv "$temp_update" ".flowforge/bug-backlog.json"
                echo "✅ Closed local bug #$bug_id"
                ((batch_success++))
            fi
        fi
    done
    
    echo "$batch_success:$batch_failed"
}

process_batch_assign() {
    local combined_data="$1"
    local batch_value="$2"
    local batch_success=0
    local batch_failed=0
    
    jq -r '.bugs[] | @json' "$combined_data" | while IFS= read -r bug_json; do
        local bug_id=$(echo "$bug_json" | jq -r '.github.number // .id')
        local bug_source=$(echo "$bug_json" | jq -r '.source // "local"')
        
        if [ "$bug_source" = "github" ]; then
            if gh issue edit "$bug_id" --add-assignee "$batch_value" 2>/dev/null; then
                echo "✅ Assigned GitHub issue #$bug_id to $batch_value"
                ((batch_success++))
            else
                echo "❌ Failed to assign GitHub issue #$bug_id"
                ((batch_failed++))
            fi
        else
            if [ -f ".flowforge/bug-backlog.json" ]; then
                local temp_update="/tmp/flowforge_batch_update_$$.json"
                jq --arg id "$bug_id" --arg assignee "$batch_value" '.bugs |= map(if (.id == $id or .id == ($id | tonumber)) then .assignee = $assignee else . end)' ".flowforge/bug-backlog.json" > "$temp_update" && mv "$temp_update" ".flowforge/bug-backlog.json"
                echo "✅ Assigned local bug #$bug_id to $batch_value"
                ((batch_success++))
            fi
        fi
    done
    
    echo "$batch_success:$batch_failed"
}

process_batch_priority() {
    local combined_data="$1"
    local batch_value="$2"
    local batch_success=0
    local batch_failed=0
    
    # Validate priority value
    if [[ ! "$batch_value" =~ ^(critical|high|medium|low)$ ]]; then
        echo "❌ Invalid priority: $batch_value (must be critical|high|medium|low)"
        return 1
    fi
    
    jq -r '.bugs[] | @json' "$combined_data" | while IFS= read -r bug_json; do
        local bug_id=$(echo "$bug_json" | jq -r '.github.number // .id')
        local bug_source=$(echo "$bug_json" | jq -r '.source // "local"')
        
        if [ "$bug_source" = "github" ]; then
            # Remove existing priority labels
            for old_priority in critical high medium low; do
                gh issue edit "$bug_id" --remove-label "$old_priority" 2>/dev/null || true
            done
            # Add new priority label
            if gh issue edit "$bug_id" --add-label "$batch_value" 2>/dev/null; then
                echo "✅ Changed priority of GitHub issue #$bug_id to $batch_value"
                ((batch_success++))
            else
                echo "❌ Failed to update priority of GitHub issue #$bug_id"
                ((batch_failed++))
            fi
        else
            if [ -f ".flowforge/bug-backlog.json" ]; then
                local temp_update="/tmp/flowforge_batch_update_$$.json"
                jq --arg id "$bug_id" --arg priority "$batch_value" '.bugs |= map(if (.id == $id or .id == ($id | tonumber)) then .priority = $priority else . end)' ".flowforge/bug-backlog.json" > "$temp_update" && mv "$temp_update" ".flowforge/bug-backlog.json"
                echo "✅ Changed priority of local bug #$bug_id to $batch_value"
                ((batch_success++))
            fi
        fi
    done
    
    echo "$batch_success:$batch_failed"
}

process_batch_status() {
    local combined_data="$1"
    local batch_value="$2"
    local batch_success=0
    local batch_failed=0
    
    # Validate status value
    if [[ ! "$batch_value" =~ ^(open|closed|in_progress)$ ]]; then
        echo "❌ Invalid status: $batch_value (must be open|closed|in_progress)"
        return 1
    fi
    
    jq -r '.bugs[] | @json' "$combined_data" | while IFS= read -r bug_json; do
        local bug_id=$(echo "$bug_json" | jq -r '.github.number // .id')
        local bug_source=$(echo "$bug_json" | jq -r '.source // "local"')
        
        if [ "$bug_source" = "github" ]; then
            case "$batch_value" in
                closed)
                    if gh issue close "$bug_id" 2>/dev/null; then
                        echo "✅ Closed GitHub issue #$bug_id"
                        ((batch_success++))
                    else
                        echo "❌ Failed to close GitHub issue #$bug_id"
                        ((batch_failed++))
                    fi
                    ;;
                open)
                    if gh issue reopen "$bug_id" 2>/dev/null; then
                        echo "✅ Reopened GitHub issue #$bug_id"
                        ((batch_success++))
                    else
                        echo "❌ Failed to reopen GitHub issue #$bug_id"
                        ((batch_failed++))
                    fi
                    ;;
                in_progress)
                    if gh issue edit "$bug_id" --add-label "in-progress" 2>/dev/null; then
                        echo "✅ Marked GitHub issue #$bug_id as in progress"
                        ((batch_success++))
                    else
                        echo "❌ Failed to update GitHub issue #$bug_id"
                        ((batch_failed++))
                    fi
                    ;;
            esac
        else
            if [ -f ".flowforge/bug-backlog.json" ]; then
                local temp_update="/tmp/flowforge_batch_update_$$.json"
                jq --arg id "$bug_id" --arg status "$batch_value" '.bugs |= map(if (.id == $id or .id == ($id | tonumber)) then .status = $status else . end)' ".flowforge/bug-backlog.json" > "$temp_update" && mv "$temp_update" ".flowforge/bug-backlog.json"
                echo "✅ Changed status of local bug #$bug_id to $batch_value"
                ((batch_success++))
            fi
        fi
    done
    
    echo "$batch_success:$batch_failed"
}

# Complex filtering logic
apply_complex_filters() {
    local combined_data="$1"
    local priority_filter="$2"
    local status_filter="$3"
    local assignee_filter="$4"
    local tags_filter="$5"
    local search_filter="$6"
    local since_filter="$7"
    local until_filter="$8"
    
    local filter_query='.bugs'
    local filter_applied=false
    
    # Priority filter
    if [ -n "$priority_filter" ]; then
        IFS=',' read -ra priorities <<< "$priority_filter"
        local priority_conditions=()
        for priority in "${priorities[@]}"; do
            priority=$(echo "$priority" | xargs)
            priority_conditions+=(".priority == \"$priority\"")
        done
        local priority_jq=$(IFS=' or '; echo "${priority_conditions[*]}")
        filter_query+=" | map(select($priority_jq))"
        filter_applied=true
    fi
    
    # Status filter
    if [ -n "$status_filter" ]; then
        IFS=',' read -ra statuses <<< "$status_filter"
        local status_conditions=()
        for status in "${statuses[@]}"; do
            status=$(echo "$status" | xargs)
            status_conditions+=(".status == \"$status\"")
        done
        local status_jq=$(IFS=' or '; echo "${status_conditions[*]}")
        filter_query+=" | map(select($status_jq))"
        filter_applied=true
    fi
    
    # Assignee filter
    if [ -n "$assignee_filter" ]; then
        if [ "$assignee_filter" = "me" ]; then
            if current_user=$(gh api user --jq .login 2>/dev/null); then
                filter_query+=" | map(select(.assignee == \"$current_user\"))"
            fi
        else
            filter_query+=" | map(select(.assignee == \"$assignee_filter\"))"
        fi
        filter_applied=true
    fi
    
    # Tags filter
    if [ -n "$tags_filter" ]; then
        IFS=',' read -ra tags <<< "$tags_filter"
        local tag_conditions=()
        for tag in "${tags[@]}"; do
            tag=$(echo "$tag" | xargs)
            tag_conditions+=("(.tags // []) | contains([\"$tag\"])")
        done
        local tag_jq=$(IFS=' or '; echo "${tag_conditions[*]}")
        filter_query+=" | map(select($tag_jq))"
        filter_applied=true
    fi
    
    # Search filter
    if [ -n "$search_filter" ]; then
        local search_escaped=$(echo "$search_filter" | sed 's/"/\\"/g')
        filter_query+=" | map(select(.title // \"\" | test(\"$search_escaped\"; \"i\")) or select(.description // \"\" | test(\"$search_escaped\"; \"i\")))"
        filter_applied=true
    fi
    
    # Date filters
    if [ -n "$since_filter" ]; then
        local since_date="$since_filter"
        if [[ "$since_filter" =~ ^[0-9]+\ (day|week|month|year)s?\ ago$ ]]; then
            since_date=$(date -d "$since_filter" -Iseconds 2>/dev/null || echo "$since_filter")
        fi
        filter_query+=" | map(select(.created >= \"$since_date\"))"
        filter_applied=true
    fi
    
    if [ -n "$until_filter" ]; then
        local until_date=$(date -d "$until_filter" -Iseconds 2>/dev/null || echo "$until_filter")
        filter_query+=" | map(select(.created <= \"$until_date\"))"
        filter_applied=true
    fi
    
    echo "$filter_query"
}

# Table formatting functions
format_priority_table() {
    local combined_data="$1"
    local priority="$2"
    local color_codes="$3"
    
    # Parse color codes
    local RED=$(echo "$color_codes" | cut -d'|' -f1)
    local YELLOW=$(echo "$color_codes" | cut -d'|' -f2)
    local BLUE=$(echo "$color_codes" | cut -d'|' -f3)
    local GREEN=$(echo "$color_codes" | cut -d'|' -f4)
    local GRAY=$(echo "$color_codes" | cut -d'|' -f5)
    local CYAN=$(echo "$color_codes" | cut -d'|' -f6)
    local BOLD=$(echo "$color_codes" | cut -d'|' -f7)
    local NC=$(echo "$color_codes" | cut -d'|' -f8)
    
    local priority_bugs=$(jq ".bugs | map(select(.priority == \"$priority\"))" "$combined_data" 2>/dev/null)
    local priority_count=$(echo "$priority_bugs" | jq 'length' 2>/dev/null || echo "0")
    
    if [ "$priority_count" != "0" ]; then
        # Priority header with color
        local priority_color="$NC"
        local priority_icon="🐛"
        case "$priority" in
            critical) 
                priority_color="$RED"
                priority_icon="🔥"
                ;;
            high) 
                priority_color="$YELLOW"
                priority_icon="⚠️"
                ;;
            medium) 
                priority_color="$BLUE"
                priority_icon="🐛"
                ;;
            low) 
                priority_color="$GREEN"
                priority_icon="💡"
                ;;
        esac
        
        echo ""
        echo -e "${BOLD}$priority_color$priority_icon ${priority^^} PRIORITY ($priority_count bugs)${NC}"
        echo "────────────────────────────────────────────────────"
        
        # Display bugs in this priority
        echo "$priority_bugs" | jq -r '.[] | 
            (.github.number // .id | tostring) + " | " + 
            .title + " | " + 
            (.assignee // "unassigned") + " | " + 
            (.created | split("T")[0]) + " | " +
            (if .github.url then .github.url else "no-url" end)' | 
        while IFS='|' read -r id title assignee created url; do
            # Trim spaces
            id=$(echo "$id" | xargs)
            title=$(echo "$title" | xargs)
            assignee=$(echo "$assignee" | xargs)
            created=$(echo "$created" | xargs)
            url=$(echo "$url" | xargs)
            
            # Format output with fixed widths
            printf "${priority_color}#%-4s${NC} %-50s ${GRAY}%s${NC} ${CYAN}%s${NC}\n" \
                "$id" \
                "$(echo "$title" | cut -c1-50)" \
                "$assignee" \
                "$created"
            
            if [ "$url" != "no-url" ] && [ -n "$url" ]; then
                printf "      ${GRAY}→ %s${NC}\n" "$url"
            fi
        done
    fi
}

# Export functions
export_to_csv() {
    local combined_data="$1"
    local output_file="$2"
    
    echo "ID,Title,Priority,Status,Assignee,Created,Updated,URL,Tags" > "$output_file"
    
    jq -r '.bugs[] | [
        (.github.number // .id),
        .title,
        .priority,
        .status,
        (.assignee // ""),
        .created,
        (.updated // ""),
        (.github.url // ""),
        ((.tags // []) | join(";"))
    ] | @csv' "$combined_data" >> "$output_file"
}

export_to_markdown() {
    local combined_data="$1"
    local output_file="$2"
    local group_field="$3"
    local final_bug_count="$4"
    
    {
        echo "# Bug Report"
        echo ""
        echo "Generated: $(date)"
        echo "Total bugs: $final_bug_count"
        echo ""
        
        # Group by priority if requested
        if [ "$group_field" = "priority" ] || [ -z "$group_field" ]; then
            for priority in critical high medium low; do
                local priority_count=$(jq ".bugs | map(select(.priority == \"$priority\")) | length" "$combined_data" 2>/dev/null || echo "0")
                if [ "$priority_count" != "0" ]; then
                    local priority_icon="🐛"
                    case "$priority" in
                        critical) priority_icon="🔥" ;;
                        high) priority_icon="⚠️" ;;
                        medium) priority_icon="🐛" ;;
                        low) priority_icon="💡" ;;
                    esac
                    
                    echo "## $priority_icon ${priority^} Priority ($priority_count bugs)"
                    echo ""
                    
                    jq -r ".bugs | map(select(.priority == \"$priority\")) | .[] | 
                        \"- **#\" + ((.github.number // .id) | tostring) + \"** \" + .title + 
                        (if .assignee then \" (\" + .assignee + \")\" else \"\" end) +
                        (if .github.url then (\" [→](\" + (.github.url) + \")\") else \"\" end)" "$combined_data"
                    echo ""
                fi
            done
        else
            echo "| ID | Title | Priority | Status | Assignee | Created |"
            echo "|----|----|----------|--------|----------|---------|"
            
            jq -r '.bugs[] | 
                "| " + ((.github.number // .id) | tostring) + 
                " | " + .title + 
                " | " + .priority + 
                " | " + .status + 
                " | " + (.assignee // "-") + 
                " | " + (.created | split("T")[0]) + " |"' "$combined_data"
        fi
    } > "$output_file"
}