#!/bin/bash
# GitHub issue creation utilities for bug add command
# Extracted from add.md to comply with Rule #24 (700 line limit)

# Create GitHub issue with bug details
create_github_issue() {
    local TITLE="$1"
    local FULL_DESCRIPTION="$2"
    local FINAL_TAGS=("${!3}")
    local ASSIGNEE="$4"
    local MILESTONE="$5"
    
    ISSUE_URL=""
    ISSUE_NUMBER=""
    
    if ! command -v gh &> /dev/null; then
        echo "⚠️  GitHub CLI not available - cannot create issue"
        echo "💡 Install GitHub CLI: https://cli.github.com/"
        return 1
    fi
    
    # Prepare label string
    LABEL_STRING=""
    for tag in "${FINAL_TAGS[@]}"; do
        if [ -z "$LABEL_STRING" ]; then
            LABEL_STRING="$tag"
        else
            LABEL_STRING="$LABEL_STRING,$tag"
        fi
    done
    
    # Create the issue
    CREATE_COMMAND="gh issue create --title \"$TITLE\" --body \"$FULL_DESCRIPTION\" --label \"$LABEL_STRING\""
    
    # Add assignee if provided
    if [ -n "$ASSIGNEE" ]; then
        CREATE_COMMAND+=" --assignee \"$ASSIGNEE\""
    fi
    
    # Add milestone if provided  
    if [ -n "$MILESTONE" ]; then
        CREATE_COMMAND+=" --milestone \"$MILESTONE\""
    fi
    
    echo "🚀 Creating issue with command: gh issue create..."
    
    if ISSUE_URL=$(eval "$CREATE_COMMAND" 2>/dev/null); then
        ISSUE_NUMBER=$(echo "$ISSUE_URL" | grep -o '/[0-9]*$' | cut -d'/' -f2)
        echo "✅ Created issue #$ISSUE_NUMBER: $ISSUE_URL"
        
        # Export values for use in calling script
        export GITHUB_ISSUE_URL="$ISSUE_URL"
        export GITHUB_ISSUE_NUMBER="$ISSUE_NUMBER"
        return 0
    else
        echo "❌ Failed to create GitHub issue"
        echo "💡 You can create it manually later"
        return 1
    fi
}

# Build rich description with GitHub markdown
build_github_description() {
    local DESCRIPTION="$1"
    local CURRENT_TASK="$2"
    local CURRENT_BRANCH="$3"
    local CURRENT_COMMIT="$4"
    local FILES_TO_USE="$5"
    local PRIORITY_REASON="$6"
    
    # Start with base description
    RICH_DESCRIPTION="$DESCRIPTION"
    
    # Add context section
    CONTEXT_SECTION=""
    if [ -n "$CURRENT_TASK" ] || [ "$CURRENT_BRANCH" != "unknown" ] || [ -n "$FILES_TO_USE" ]; then
        CONTEXT_SECTION="

## 🔍 Context Information

"
        
        if [ -n "$CURRENT_TASK" ]; then
            CONTEXT_SECTION+="- **Current Task:** #$CURRENT_TASK"$'\n'
        fi
        
        if [ "$CURRENT_BRANCH" != "unknown" ]; then
            CONTEXT_SECTION+="- **Branch:** \`$CURRENT_BRANCH\`"$'\n'
        fi
        
        if [ -n "$CURRENT_COMMIT" ]; then
            CONTEXT_SECTION+="- **Last Commit:** $CURRENT_COMMIT"$'\n'
        fi
        
        if [ -n "$FILES_TO_USE" ]; then
            CONTEXT_SECTION+="- **Related Files:**"$'\n'
            IFS=',' read -ra FILE_ARRAY <<< "$FILES_TO_USE"
            for file in "${FILE_ARRAY[@]}"; do
                CONTEXT_SECTION+="  - \`$file\`"$'\n'
            done
        fi
    fi
    
    # Add reproduction section
    REPRODUCTION_SECTION="

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

"
    
    FULL_DESCRIPTION="$RICH_DESCRIPTION$CONTEXT_SECTION$REPRODUCTION_SECTION"
    FULL_DESCRIPTION+="

---
*Created by FlowForge Bug Addition System*
*Priority auto-detected: $PRIORITY_REASON*"
    
    echo "$FULL_DESCRIPTION"
}

# Check if GitHub CLI is authenticated
check_github_auth() {
    if command -v gh &> /dev/null; then
        if gh auth status &>/dev/null; then
            return 0
        else
            echo "⚠️  GitHub CLI not authenticated"
            echo "💡 Run: gh auth login"
            return 1
        fi
    else
        echo "⚠️  GitHub CLI not installed"
        return 1
    fi
}

# Get current GitHub repository info
get_github_repo_info() {
    if git remote get-url origin &>/dev/null; then
        REPO_URL=$(git remote get-url origin)
        if [[ "$REPO_URL" =~ github.com[:/]([^/]+)/([^.]+) ]]; then
            export GITHUB_OWNER="${BASH_REMATCH[1]}"
            export GITHUB_REPO="${BASH_REMATCH[2]}"
            echo "📍 Repository: $GITHUB_OWNER/$GITHUB_REPO"
            return 0
        fi
    fi
    return 1
}