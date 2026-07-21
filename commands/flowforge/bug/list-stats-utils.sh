#!/bin/bash
# Statistics and grouping utilities for bug list command
# Extracted from list.md to comply with Rule #24 (700 line limit)

# Apply filters to bug data
apply_filters() {
    local COMBINED_DATA="$1"
    local PRIORITY_FILTER="$2"
    local STATUS_FILTER="$3"
    local ASSIGNEE_FILTER="$4"
    local TAGS_FILTER="$5"
    local SEARCH_FILTER="$6"
    local SINCE_FILTER="$7"
    local UNTIL_FILTER="$8"
    local TEMP_FILES_REF="$9"
    
    FILTER_QUERY='.bugs'
    FILTER_APPLIED=false
    
    # Priority filter
    if [ -n "$PRIORITY_FILTER" ]; then
        IFS=',' read -ra PRIORITIES <<< "$PRIORITY_FILTER"
        PRIORITY_CONDITIONS=()
        for priority in "${PRIORITIES[@]}"; do
            priority=$(echo "$priority" | xargs) # Trim whitespace
            PRIORITY_CONDITIONS+=(".priority == \"$priority\"")
        done
        PRIORITY_JQ=$(IFS=' or '; echo "${PRIORITY_CONDITIONS[*]}")
        FILTER_QUERY+=" | map(select($PRIORITY_JQ))"
        FILTER_APPLIED=true
    fi
    
    # Status filter
    if [ -n "$STATUS_FILTER" ]; then
        IFS=',' read -ra STATUSES <<< "$STATUS_FILTER"
        STATUS_CONDITIONS=()
        for status in "${STATUSES[@]}"; do
            status=$(echo "$status" | xargs)
            STATUS_CONDITIONS+=(".status == \"$status\"")
        done
        STATUS_JQ=$(IFS=' or '; echo "${STATUS_CONDITIONS[*]}")
        FILTER_QUERY+=" | map(select($STATUS_JQ))"
        FILTER_APPLIED=true
    fi
    
    # Assignee filter
    if [ -n "$ASSIGNEE_FILTER" ]; then
        if [ "$ASSIGNEE_FILTER" = "me" ]; then
            # Get current GitHub user
            if CURRENT_USER=$(gh api user --jq .login 2>/dev/null); then
                FILTER_QUERY+=" | map(select(.assignee == \"$CURRENT_USER\"))"
            else
                echo "⚠️  Could not determine current user - skipping assignee filter"
            fi
        else
            FILTER_QUERY+=" | map(select(.assignee == \"$ASSIGNEE_FILTER\"))"
        fi
        FILTER_APPLIED=true
    fi
    
    # Tags filter
    if [ -n "$TAGS_FILTER" ]; then
        IFS=',' read -ra TAGS <<< "$TAGS_FILTER"
        TAG_CONDITIONS=()
        for tag in "${TAGS[@]}"; do
            tag=$(echo "$tag" | xargs)
            TAG_CONDITIONS+=("(.tags // []) | contains([\"$tag\"])")
        done
        TAG_JQ=$(IFS=' or '; echo "${TAG_CONDITIONS[*]}")
        FILTER_QUERY+=" | map(select($TAG_JQ))"
        FILTER_APPLIED=true
    fi
    
    # Search filter (in title and description)
    if [ -n "$SEARCH_FILTER" ]; then
        SEARCH_ESCAPED=$(echo "$SEARCH_FILTER" | sed 's/"/\\"/g')
        FILTER_QUERY+=" | map(select(.title // \"\" | test(\"$SEARCH_ESCAPED\"; \"i\")) or select(.description // \"\" | test(\"$SEARCH_ESCAPED\"; \"i\")))"
        FILTER_APPLIED=true
    fi
    
    # Date filters
    if [ -n "$SINCE_FILTER" ]; then
        # Convert relative dates
        if [[ "$SINCE_FILTER" =~ ^[0-9]+\ (day|week|month|year)s?\ ago$ ]]; then
            SINCE_DATE=$(date -d "$SINCE_FILTER" -Iseconds 2>/dev/null || echo "$SINCE_FILTER")
        else
            SINCE_DATE="$SINCE_FILTER"
        fi
        FILTER_QUERY+=" | map(select(.created >= \"$SINCE_DATE\"))"
        FILTER_APPLIED=true
    fi
    
    if [ -n "$UNTIL_FILTER" ]; then
        UNTIL_DATE=$(date -d "$UNTIL_FILTER" -Iseconds 2>/dev/null || echo "$UNTIL_FILTER")
        FILTER_QUERY+=" | map(select(.created <= \"$UNTIL_DATE\"))"
        FILTER_APPLIED=true
    fi
    
    # Apply filters
    if [ "$FILTER_APPLIED" = true ]; then
        FILTERED_DATA="/tmp/flowforge_filtered_$$.json"
        eval "$TEMP_FILES_REF+=('$FILTERED_DATA')"
        jq -r "$FILTER_QUERY" "$COMBINED_DATA" > "$FILTERED_DATA" 2>/dev/null
        
        FILTERED_COUNT=$(jq 'length' "$FILTERED_DATA" 2>/dev/null || echo "0")
        echo "✅ Applied filters: $FILTERED_COUNT bugs match criteria"
        
        # Update combined data with filtered results
        jq "{\"bugs\": $FILTER_QUERY}" "$COMBINED_DATA" > "$FILTERED_DATA" 2>/dev/null && mv "$FILTERED_DATA" "$COMBINED_DATA"
    fi
}

# Apply sorting to bug data
apply_sorting() {
    local COMBINED_DATA="$1"
    local SORT_FIELD="$2"
    local TEMP_FILES_REF="$3"
    
    case "$SORT_FIELD" in
        priority)
            SORT_QUERY='.bugs |= sort_by(if .priority == "critical" then 1 elif .priority == "high" then 2 elif .priority == "medium" then 3 else 4 end)'
            ;;
        created)
            SORT_QUERY='.bugs |= sort_by(.created) | .bugs |= reverse'
            ;;
        updated)
            SORT_QUERY='.bugs |= sort_by(.updated) | .bugs |= reverse'
            ;;
        title)
            SORT_QUERY='.bugs |= sort_by(.title)'
            ;;
        *)
            SORT_QUERY='.'
            ;;
    esac
    
    if [ "$SORT_QUERY" != "." ]; then
        TEMP_SORT="/tmp/flowforge_sort_$$.json"
        eval "$TEMP_FILES_REF+=('$TEMP_SORT')"
        jq "$SORT_QUERY" "$COMBINED_DATA" > "$TEMP_SORT" 2>/dev/null && mv "$TEMP_SORT" "$COMBINED_DATA"
        echo "✅ Sorted by: $SORT_FIELD"
    fi
}

# Apply limit to results
apply_limit() {
    local COMBINED_DATA="$1"
    local LIMIT="$2"
    local TEMP_FILES_REF="$3"
    
    if [ "$LIMIT" != "0" ] && [ "$LIMIT" != "all" ]; then
        TEMP_LIMIT="/tmp/flowforge_limit_$$.json"
        eval "$TEMP_FILES_REF+=('$TEMP_LIMIT')"
        jq ".bugs |= .[0:$LIMIT]" "$COMBINED_DATA" > "$TEMP_LIMIT" 2>/dev/null && mv "$TEMP_LIMIT" "$COMBINED_DATA"
    fi
}

# Remove duplicate bugs (prefer GitHub data over local)
remove_duplicates() {
    local COMBINED_DATA="$1"
    local TEMP_FILES_REF="$2"
    
    if ! command -v jq >/dev/null 2>&1; then
        return 1
    fi
    
    TEMP_DEDUP="/tmp/flowforge_dedup_$$.json"
    eval "$TEMP_FILES_REF+=('$TEMP_DEDUP')"
    
    jq '
    .bugs |= (
        group_by(.github.number // .id) |
        map(
            if length > 1 then
                # Prefer GitHub data over local
                sort_by(.source != "github") | .[0]
            else
                .[0]
            end
        )
    )' "$COMBINED_DATA" > "$TEMP_DEDUP" 2>/dev/null && mv "$TEMP_DEDUP" "$COMBINED_DATA"
    
    FINAL_COUNT=$(jq '.bugs | length' "$COMBINED_DATA" 2>/dev/null || echo "0")
    echo "✅ Final bug count: $FINAL_COUNT (after deduplication)"
}

# Generate statistics summary
generate_statistics() {
    local COMBINED_DATA="$1"
    local USE_COLOR="$2"
    
    # Set up colors based on USE_COLOR setting
    if [ "$USE_COLOR" = "always" ]; then
        local RED='\033[0;31m'
        local YELLOW='\033[1;33m'
        local GREEN='\033[0;32m'
        local BLUE='\033[0;34m'
        local BOLD='\033[1m'
        local NC='\033[0m'
    else
        local RED=''
        local YELLOW=''
        local GREEN=''
        local BLUE=''
        local BOLD=''
        local NC=''
    fi
    
    echo ""
    echo "────────────────────────────────────────────────────"
    echo -e "${BOLD}📊 SUMMARY STATISTICS${NC}"
    echo ""
    
    for PRIORITY in critical high medium low; do
        COUNT=$(jq ".bugs | map(select(.priority == \"$PRIORITY\")) | length" "$COMBINED_DATA" 2>/dev/null || echo "0")
        if [ "$COUNT" != "0" ]; then
            PRIORITY_COLOR="$NC"
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
    CRITICAL_COUNT=$(jq '.bugs | map(select(.priority == "critical")) | length' "$COMBINED_DATA" 2>/dev/null || echo "0")
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

# Update local bug backlog for batch operations
update_local_bug() {
    local BUG_ID="$1"
    local OPERATION="$2"
    local VALUE="$3"
    local TEMP_FILES_REF="$4"
    
    if [ ! -f ".flowforge/bug-backlog.json" ]; then
        return 1
    fi
    
    TEMP_UPDATE="/tmp/flowforge_batch_update_$$.json"
    eval "$TEMP_FILES_REF+=('$TEMP_UPDATE')"
    
    case "$OPERATION" in
        close)
            jq --arg id "$BUG_ID" '.bugs |= map(if (.id == $id or .id == ($id | tonumber)) then .status = "closed" else . end)' ".flowforge/bug-backlog.json" > "$TEMP_UPDATE" && mv "$TEMP_UPDATE" ".flowforge/bug-backlog.json"
            echo "✅ Closed local bug #$BUG_ID"
            ;;
        assign)
            jq --arg id "$BUG_ID" --arg assignee "$VALUE" '.bugs |= map(if (.id == $id or .id == ($id | tonumber)) then .assignee = $assignee else . end)' ".flowforge/bug-backlog.json" > "$TEMP_UPDATE" && mv "$TEMP_UPDATE" ".flowforge/bug-backlog.json"
            echo "✅ Assigned local bug #$BUG_ID to $VALUE"
            ;;
        priority)
            jq --arg id "$BUG_ID" --arg priority "$VALUE" '.bugs |= map(if (.id == $id or .id == ($id | tonumber)) then .priority = $priority else . end)' ".flowforge/bug-backlog.json" > "$TEMP_UPDATE" && mv "$TEMP_UPDATE" ".flowforge/bug-backlog.json"
            echo "✅ Changed priority of local bug #$BUG_ID to $VALUE"
            ;;
        status)
            jq --arg id "$BUG_ID" --arg status "$VALUE" '.bugs |= map(if (.id == $id or .id == ($id | tonumber)) then .status = $status else . end)' ".flowforge/bug-backlog.json" > "$TEMP_UPDATE" && mv "$TEMP_UPDATE" ".flowforge/bug-backlog.json"
            echo "✅ Changed status of local bug #$BUG_ID to $VALUE"
            ;;
    esac
}