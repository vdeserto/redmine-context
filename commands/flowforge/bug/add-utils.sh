#!/bin/bash
# add-utils.sh - Utility functions for bug add command
# Extracted to comply with Rule #24 (700 line limit)

# Smart priority detection based on keywords
detect_priority_from_text() {
    local text="$1"
    local priority=""
    local reason=""
    
    # Convert to lowercase for comparison
    local text_lower=$(echo "$text" | tr '[:upper:]' '[:lower:]')
    
    # Critical keywords
    if [[ "$text_lower" =~ (crash|security|vulnerability|production|down|broken|critical|urgent|emergency) ]]; then
        priority="critical"
        reason="Contains critical keywords: crash, security, production, etc."
    # High priority keywords
    elif [[ "$text_lower" =~ (performance|slow|timeout|error|exception|fail|high|important|blocking) ]]; then
        priority="high"
        reason="Contains high priority keywords: performance, error, blocking, etc."
    # Medium priority keywords
    elif [[ "$text_lower" =~ (bug|issue|incorrect|wrong|missing|medium|problem) ]]; then
        priority="medium"
        reason="Contains standard bug keywords: incorrect, wrong, missing, etc."
    # Low priority keywords
    elif [[ "$text_lower" =~ (cosmetic|ui|ux|enhancement|suggestion|low|minor|trivial) ]]; then
        priority="low"
        reason="Contains low priority keywords: cosmetic, ui, minor, etc."
    else
        priority="medium"
        reason="Default priority (no specific keywords detected)"
    fi
    
    echo "$priority:$reason"
}

# Auto-detect tags from file paths
detect_tags_from_files() {
    local files="$1"
    local tags=()
    
    IFS=',' read -ra file_array <<< "$files"
    for file in "${file_array[@]}"; do
        case "$file" in
            *.js|*.ts|*.jsx|*.tsx) tags+=("frontend" "javascript") ;;
            *.py) tags+=("backend" "python") ;;
            *.go) tags+=("backend" "golang") ;;
            *.java) tags+=("backend" "java") ;;
            *.css|*.scss|*.sass) tags+=("ui" "styling") ;;
            *.html|*.vue) tags+=("frontend" "ui") ;;
            *.md|*.rst) tags+=("documentation") ;;
            *.sql) tags+=("database") ;;
            *.json|*.yaml|*.yml) tags+=("configuration") ;;
            *test*|*spec*) tags+=("testing") ;;
        esac
    done
    
    # Remove duplicates
    printf "%s\n" "${tags[@]}" | sort -u | tr '\n' ' '
}

# Validate and parse GitHub issue URL or number
parse_github_issue() {
    local input="$1"
    local issue_number=""
    
    # Check if it's a URL
    if [[ "$input" =~ github\.com/.*/issues/([0-9]+) ]]; then
        issue_number="${BASH_REMATCH[1]}"
    # Check if it's just a number
    elif [[ "$input" =~ ^[0-9]+$ ]]; then
        issue_number="$input"
    fi
    
    echo "$issue_number"
}

# Build rich bug description with context
build_bug_description() {
    local description="$1"
    local current_task="$2"
    local current_branch="$3"
    local current_commit="$4"
    local files="$5"
    local priority_reason="$6"
    
    local rich_description="$description"
    
    # Add context section
    if [ -n "$current_task" ] || [ "$current_branch" != "unknown" ] || [ -n "$files" ]; then
        rich_description+="

## 🔍 Context Information

"
        [ -n "$current_task" ] && rich_description+="- **Current Task:** #$current_task
"
        [ "$current_branch" != "unknown" ] && rich_description+="- **Branch:** \`$current_branch\`
"
        [ -n "$current_commit" ] && rich_description+="- **Last Commit:** $current_commit
"
        
        if [ -n "$files" ]; then
            rich_description+="- **Related Files:**
"
            IFS=',' read -ra file_array <<< "$files"
            for file in "${file_array[@]}"; do
                rich_description+="  - \`$file\`
"
            done
        fi
    fi
    
    # Add standard sections
    rich_description+="

## 🔄 Reproduction Steps

_To be filled when investigating the bug_

1. 
2. 
3. 

## ✅ Acceptance Criteria

_What needs to be working for this bug to be considered fixed_

- [ ] 
- [ ] 

## 🧪 Testing Notes

_How to verify the fix works_


---
*Created by FlowForge Bug Addition System*
*Priority auto-detected: $priority_reason*"
    
    echo "$rich_description"
}

# Create bug entry JSON
create_bug_entry_json() {
    local id="$1"
    local title="$2"
    local priority="$3"
    local description="$4"
    local tags="$5"
    local context_task="$6"
    local context_branch="$7"
    local context_files="$8"
    local context_commit="$9"
    local github_url="${10}"
    local github_number="${11}"
    local assignee="${12}"
    
    # Convert tags array to JSON array
    local tags_json=""
    if [ -n "$tags" ]; then
        tags_json=$(echo "$tags" | tr ' ' '\n' | sed 's/^/"/;s/$/"/' | paste -sd, -)
    fi
    
    # Convert files to JSON array
    local files_json=""
    if [ -n "$context_files" ]; then
        files_json=$(echo "$context_files" | tr ',' '\n' | sed 's/^/"/;s/$/"/' | paste -sd, -)
    fi
    
    cat << EOF
{
  "id": "${id}",
  "title": "$title",
  "priority": "$priority",
  "description": "$description",
  "tags": [${tags_json:-}],
  "context": {
    "task": ${context_task:+\"$context_task\"},
    "branch": "$context_branch",
    "files": [${files_json:-}],
    "commit": "$context_commit"
  },
  "github": {
    "url": ${github_url:+\"$github_url\"},
    "number": ${github_number:+\"$github_number\"}
  },
  "created": "$(date -Iseconds)",
  "status": "open",
  "estimatedTime": null,
  "assignee": ${assignee:+\"$assignee\"}
}
EOF
}

# Interactive priority selection
select_priority_interactive() {
    local detected_priority="$1"
    local detected_reason="$2"
    
    echo "🔍 Auto-detected priority: $detected_priority"
    echo "  Reason: $detected_reason"
    echo ""
    echo "Select priority:"
    echo "1) Critical (production down, security issue)"
    echo "2) High (major feature broken, performance issue)"  
    echo "3) Medium (standard bug, incorrect behavior)"
    echo "4) Low (cosmetic, minor enhancement)"
    echo "5) Keep detected: $detected_priority"
    echo -n "Choice [1-5]: "
    
    read -r choice
    case "$choice" in
        1) echo "critical" ;;
        2) echo "high" ;;
        3) echo "medium" ;;
        4) echo "low" ;;
        5|"") echo "$detected_priority" ;;
        *) echo "$detected_priority" ;;
    esac
}