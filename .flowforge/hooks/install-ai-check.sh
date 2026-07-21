#!/bin/bash
# Install AI reference check into git hooks

set -e

# Check if we're in a git repository
if [ ! -d ".git" ]; then
    echo "Error: Not in a git repository"
    exit 1
fi

# Create hooks directory if it doesn't exist
mkdir -p .git/hooks

# Add AI check to commit-msg hook
if [ -f ".git/hooks/commit-msg" ]; then
    # Backup existing hook
    cp .git/hooks/commit-msg .git/hooks/commit-msg.bak
    
    # Check if AI check already exists
    if ! grep -q "check-ai-references" .git/hooks/commit-msg; then
        # Insert AI check before existing content
        cat > .git/hooks/commit-msg.tmp << 'EOF'
#!/bin/bash
# FlowForge Enhanced Commit Message Hook

# Run AI reference check
if [ -f ".flowforge/hooks/check-ai-references.sh" ]; then
    .flowforge/hooks/check-ai-references.sh "$1"
    if [ $? -ne 0 ]; then
        exit 1
    fi
fi

# Original commit-msg hook content follows:
EOF
        
        # Append original content (skip shebang)
        tail -n +2 .git/hooks/commit-msg >> .git/hooks/commit-msg.tmp
        
        # Replace with new version
        mv .git/hooks/commit-msg.tmp .git/hooks/commit-msg
        chmod +x .git/hooks/commit-msg
    fi
else
    # Create new commit-msg hook
    cat > .git/hooks/commit-msg << 'EOF'
#!/bin/bash
# FlowForge Commit Message Hook

# Run AI reference check
if [ -f ".flowforge/hooks/check-ai-references.sh" ]; then
    .flowforge/hooks/check-ai-references.sh "$1"
    if [ $? -ne 0 ]; then
        exit 1
    fi
fi

# Check conventional commit format
commit_regex='^(feat|fix|docs|style|refactor|test|chore|perf|ci|build|revert)(\(.+\))?: .{1,50}'

if ! grep -qE "$commit_regex" "$1"; then
    echo "❌ Invalid commit message format!"
    echo "Format: <type>(<scope>): <subject>"
    echo "Example: feat(auth): add login endpoint"
    echo ""
    echo "Types: feat|fix|docs|style|refactor|test|chore|perf|ci|build|revert"
    exit 1
fi
EOF
    chmod +x .git/hooks/commit-msg
fi

echo "✅ AI reference check installed in git hooks"
echo "   Rule #33 will be enforced on all commits"