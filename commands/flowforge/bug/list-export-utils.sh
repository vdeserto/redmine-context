#!/bin/bash
# Export functionality utilities for bug list command
# Extracted from list.md to comply with Rule #24 (700 line limit)

# Export bugs to CSV format
export_csv() {
    local COMBINED_DATA="$1"
    local OUTPUT_FILE="$2"
    local FINAL_BUG_COUNT="$3"
    
    echo "ID,Title,Priority,Status,Assignee,Created,Updated,URL,Tags" > "$OUTPUT_FILE"
    
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
    ] | @csv' "$COMBINED_DATA" >> "$OUTPUT_FILE"
    
    if [ -n "$OUTPUT_FILE" ] && [ "$OUTPUT_FILE" != "/dev/stdout" ]; then
        echo "✅ Exported $FINAL_BUG_COUNT bugs to $OUTPUT_FILE (CSV format)"
    fi
}

# Export bugs to Markdown format
export_markdown() {
    local COMBINED_DATA="$1"
    local OUTPUT_FILE="$2"
    local FINAL_BUG_COUNT="$3"
    local GROUP_FIELD="$4"
    
    {
        echo "# Bug Report"
        echo ""
        echo "Generated: $(date)"
        echo "Total bugs: $FINAL_BUG_COUNT"
        echo ""
        
        # Group by priority if requested
        if [ "$GROUP_FIELD" = "priority" ] || [ -z "$GROUP_FIELD" ]; then
            for PRIORITY in critical high medium low; do
                PRIORITY_COUNT=$(jq ".bugs | map(select(.priority == \"$PRIORITY\")) | length" "$COMBINED_DATA" 2>/dev/null || echo "0")
                if [ "$PRIORITY_COUNT" != "0" ]; then
                    PRIORITY_ICON="🐛"
                    case "$PRIORITY" in
                        critical) PRIORITY_ICON="🔥" ;;
                        high) PRIORITY_ICON="⚠️" ;;
                        medium) PRIORITY_ICON="🐛" ;;
                        low) PRIORITY_ICON="💡" ;;
                    esac
                    
                    echo "## $PRIORITY_ICON ${PRIORITY^} Priority ($PRIORITY_COUNT bugs)"
                    echo ""
                    
                    jq -r ".bugs | map(select(.priority == \"$PRIORITY\")) | .[] | 
                        \"- **#\" + ((.github.number // .id) | tostring) + \"** \" + .title + 
                        (if .assignee then \" (\" + .assignee + \")\" else \"\" end) +
                        (if .github.url then (\" [→](\" + (.github.url) + \")\") else \"\" end)" "$COMBINED_DATA"
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
                " | " + (.created | split("T")[0]) + " |"' "$COMBINED_DATA"
        fi
    } > "$OUTPUT_FILE"
    
    if [ -n "$OUTPUT_FILE" ] && [ "$OUTPUT_FILE" != "/dev/stdout" ]; then
        echo "✅ Exported $FINAL_BUG_COUNT bugs to $OUTPUT_FILE (Markdown format)"
    fi
}

# Export bugs to JSON format
export_json() {
    local COMBINED_DATA="$1"
    local EXPORT_FILE="$2"
    local FINAL_BUG_COUNT="$3"
    
    if [ -n "$EXPORT_FILE" ]; then
        cp "$COMBINED_DATA" "$EXPORT_FILE"
        echo "✅ Exported $FINAL_BUG_COUNT bugs to $EXPORT_FILE"
    else
        cat "$COMBINED_DATA"
    fi
}

# Generate export based on template
export_with_template() {
    local COMBINED_DATA="$1"
    local OUTPUT_FILE="$2"
    local TEMPLATE="$3"
    local FORMAT="$4"
    
    case "$TEMPLATE" in
        summary)
            # Summary template - minimal info
            case "$FORMAT" in
                csv)
                    echo "Priority,Count,Critical_Action_Needed" > "$OUTPUT_FILE"
                    for priority in critical high medium low; do
                        count=$(jq ".bugs | map(select(.priority == \"$priority\")) | length" "$COMBINED_DATA" 2>/dev/null || echo "0")
                        action="No"
                        [ "$priority" = "critical" ] && [ "$count" != "0" ] && action="Yes"
                        echo "$priority,$count,$action" >> "$OUTPUT_FILE"
                    done
                    ;;
                markdown)
                    {
                        echo "# Bug Summary Report"
                        echo "Date: $(date)"
                        echo ""
                        for priority in critical high medium low; do
                            count=$(jq ".bugs | map(select(.priority == \"$priority\")) | length" "$COMBINED_DATA" 2>/dev/null || echo "0")
                            [ "$count" != "0" ] && echo "- **${priority^}**: $count bugs"
                        done
                    } > "$OUTPUT_FILE"
                    ;;
            esac
            ;;
            
        detailed)
            # Detailed template - full information
            case "$FORMAT" in
                csv)
                    export_csv "$COMBINED_DATA" "$OUTPUT_FILE" ""
                    ;;
                markdown)
                    export_markdown "$COMBINED_DATA" "$OUTPUT_FILE" "" "priority"
                    ;;
            esac
            ;;
            
        report)
            # Executive report template
            {
                echo "# Executive Bug Report"
                echo "Generated: $(date)"
                echo ""
                echo "## Executive Summary"
                
                local total=$(jq '.bugs | length' "$COMBINED_DATA" 2>/dev/null || echo "0")
                local critical=$(jq '.bugs | map(select(.priority == "critical")) | length' "$COMBINED_DATA" 2>/dev/null || echo "0")
                local open=$(jq '.bugs | map(select(.status == "open")) | length' "$COMBINED_DATA" 2>/dev/null || echo "0")
                
                echo "- Total bugs: $total"
                echo "- Open bugs: $open"
                echo "- Critical bugs requiring immediate action: $critical"
                echo ""
                
                if [ "$critical" != "0" ]; then
                    echo "## ⚠️ Critical Issues Requiring Immediate Attention"
                    echo ""
                    jq -r '.bugs | map(select(.priority == "critical")) | .[] | 
                        "### Bug #" + ((.github.number // .id) | tostring) + ": " + .title + "\n" +
                        "- **Status**: " + .status + "\n" +
                        "- **Assignee**: " + (.assignee // "Unassigned") + "\n" +
                        "- **Created**: " + (.created | split("T")[0]) + "\n"' "$COMBINED_DATA"
                fi
                
                echo "## Recommendations"
                echo ""
                [ "$critical" != "0" ] && echo "1. Address $critical critical bugs immediately"
                echo "2. Review and prioritize open bugs"
                echo "3. Assign resources to unassigned high-priority bugs"
                
            } > "$OUTPUT_FILE"
            ;;
    esac
    
    echo "✅ Generated $TEMPLATE report: $OUTPUT_FILE"
}