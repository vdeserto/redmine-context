#!/bin/bash
# GitHub integration utilities for bug list command
# Extracted from list.md to comply with Rule #24 (700 line limit)

# Load bugs from GitHub Issues
load_github_bugs() {
    local COMBINED_DATA="$1"
    local STATUS_FILTER="$2"
    local ASSIGNEE_FILTER="$3"
    local SEARCH_FILTER="$4"
    local LIMIT="$5"
    local TEMP_FILES_REF="$6"
    
    if ! command -v gh &> /dev/null; then
        echo "⚠️  GitHub CLI not available - skipping GitHub issues"
        return 1
    fi
    
    echo "🐙 Loading from GitHub Issues..."
    
    # Build GitHub query based on filters
    GH_QUERY="is:issue"
    
    if [ -n "$STATUS_FILTER" ]; then
        case "$STATUS_FILTER" in
            open) GH_QUERY+=" is:open" ;;
            closed) GH_QUERY+=" is:closed" ;;
            *) ;; # Don't add status filter for other values
        esac
    fi
    
    if [ -n "$ASSIGNEE_FILTER" ]; then
        if [ "$ASSIGNEE_FILTER" = "me" ]; then
            GH_QUERY+=" assignee:@me"
        else
            GH_QUERY+=" assignee:$ASSIGNEE_FILTER"
        fi
    fi
    
    if [ -n "$SEARCH_FILTER" ]; then
        GH_QUERY+=" $SEARCH_FILTER"
    fi
    
    # Add label filter for bugs
    GH_QUERY+=" label:bug"
    
    echo "🔍 GitHub query: $GH_QUERY"
    
    # Fetch issues from GitHub
    if GH_ISSUES=$(gh issue list --search "$GH_QUERY" --limit "$LIMIT" --json number,title,state,labels,assignees,createdAt,updatedAt,url,body 2>/dev/null); then
        # Convert GitHub format to FlowForge format
        TEMP_GH="/tmp/flowforge_gh_$$.json"
        eval "$TEMP_FILES_REF+=('$TEMP_GH')"
        
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
        }' > "$TEMP_GH" 2>/dev/null
        
        # Merge GitHub data with combined data
        if [ -s "$TEMP_GH" ]; then
            TEMP_MERGE="/tmp/flowforge_merge_gh_$$.json"
            eval "$TEMP_FILES_REF+=('$TEMP_MERGE')"
            jq -s '.[0].bugs += .[1].bugs | .[0]' "$COMBINED_DATA" "$TEMP_GH" > "$TEMP_MERGE" 2>/dev/null && mv "$TEMP_MERGE" "$COMBINED_DATA"
            GH_COUNT=$(jq '.bugs | map(select(.source == "github")) | length' "$COMBINED_DATA" 2>/dev/null || echo "0")
            echo "✅ Loaded $GH_COUNT issues from GitHub"
            return 0
        fi
    else
        echo "⚠️  Could not load GitHub issues (check authentication)"
    fi
    
    return 1
}

# Handle GitHub-specific batch operations
github_batch_close() {
    local BUG_ID="$1"
    if gh issue close "$BUG_ID" 2>/dev/null; then
        echo "✅ Closed GitHub issue #$BUG_ID"
        return 0
    else
        echo "❌ Failed to close GitHub issue #$BUG_ID"
        return 1
    fi
}

github_batch_assign() {
    local BUG_ID="$1"
    local ASSIGNEE="$2"
    if gh issue edit "$BUG_ID" --add-assignee "$ASSIGNEE" 2>/dev/null; then
        echo "✅ Assigned GitHub issue #$BUG_ID to $ASSIGNEE"
        return 0
    else
        echo "❌ Failed to assign GitHub issue #$BUG_ID"
        return 1
    fi
}

github_batch_priority() {
    local BUG_ID="$1"
    local PRIORITY="$2"
    
    # Remove existing priority labels
    for old_priority in critical high medium low; do
        gh issue edit "$BUG_ID" --remove-label "$old_priority" 2>/dev/null || true
    done
    
    # Add new priority label
    if gh issue edit "$BUG_ID" --add-label "$PRIORITY" 2>/dev/null; then
        echo "✅ Changed priority of GitHub issue #$BUG_ID to $PRIORITY"
        return 0
    else
        echo "❌ Failed to update priority of GitHub issue #$BUG_ID"
        return 1
    fi
}

github_batch_status() {
    local BUG_ID="$1"
    local STATUS="$2"
    
    case "$STATUS" in
        closed)
            if gh issue close "$BUG_ID" 2>/dev/null; then
                echo "✅ Closed GitHub issue #$BUG_ID"
                return 0
            else
                echo "❌ Failed to close GitHub issue #$BUG_ID"
                return 1
            fi
            ;;
        open)
            if gh issue reopen "$BUG_ID" 2>/dev/null; then
                echo "✅ Reopened GitHub issue #$BUG_ID"
                return 0
            else
                echo "❌ Failed to reopen GitHub issue #$BUG_ID"
                return 1
            fi
            ;;
        in_progress)
            # Add in-progress label
            if gh issue edit "$BUG_ID" --add-label "in-progress" 2>/dev/null; then
                echo "✅ Marked GitHub issue #$BUG_ID as in progress"
                return 0
            else
                echo "❌ Failed to update GitHub issue #$BUG_ID"
                return 1
            fi
            ;;
    esac
}

# Get current GitHub user for assignee filters
get_github_user() {
    if gh api user --jq .login 2>/dev/null; then
        return 0
    else
        return 1
    fi
}