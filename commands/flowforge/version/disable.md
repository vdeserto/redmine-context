# Command: flowforge:version:disable
# Version: 2.0.0
# Description: FlowForge version disable command

---
description: Disable version tracking for your project
argument-hint: "[help]"
---

# 🔻 Disable Project Versioning

This command disables version tracking for your project while preserving history.

## ⚠️ Confirmation
```bash
# Check if help is requested FIRST (before strict mode)
if [[ "${ARGUMENTS:-}" == "?" || "${ARGUMENTS:-}" == "help" ]]; then
    cat << 'EOF'
🔻 Disable Version Tracking

Disable version tracking while preserving history.

Usage: /flowforge:version:disable [help]

Arguments:
  help, ?    Show this help message

This command will:
  • Remove VERSION file
  • Remove version commands
  • Remove version badges
  • Keep CHANGELOG.md for history
  • Save disable record

Prerequisites:
  - Version tracking enabled
  - Interactive terminal
  - Write permissions

Examples:
  /flowforge:version:disable     - Disable versioning
  /flowforge:version:disable ?   - Show this help

Related commands:
  /flowforge:version:enable      - Enable versioning
  /flowforge:version:check       - Check current version
EOF
    exit 0
fi

# Now enable strict error handling
set -euo pipefail

# Error handler function
handle_error() {
    local exit_code=$?
    local line_number=$1
    echo "❌ Error on line $line_number (exit code: $exit_code)"
    
    # Provide helpful error messages based on context
    if [[ "${BASH_COMMAND:-}" =~ "rm.*VERSION" ]]; then
        echo "💡 Failed to remove VERSION file"
        echo "   Check file permissions"
    elif [[ "${BASH_COMMAND:-}" =~ "rm.*commands" ]]; then
        echo "💡 Failed to remove version commands"
        echo "   Check file permissions in .claude/commands/"
    elif [[ "${BASH_COMMAND:-}" =~ "sed" ]]; then
        echo "💡 Failed to update documentation"
        echo "   Files may be read-only or missing"
    elif [[ "${BASH_COMMAND:-}" =~ "cat.*>.*flowforge" ]]; then
        echo "💡 Failed to create disable record"
        echo "   Check write permissions in .flowforge/"
    fi
    
    echo ""
    echo "💡 To disable version tracking manually:"
    echo "   1. Remove VERSION file: rm VERSION"
    echo "   2. Remove commands: rm .claude/commands/version*.md"
    echo "   3. Update README.md to remove badge"
    
    exit $exit_code
}

# Set error trap
trap 'handle_error $LINENO' ERR

# Enable debug mode if DEBUG=1
[[ "${DEBUG:-0}" == "1" ]] && set -x

# Handle non-interactive mode (skip for testing)
if [[ "${FLOWFORGE_TEST:-}" != "true" ]]; then
    if [[ ! -t 0 ]] || [[ "${CI:-false}" == "true" ]]; then
        echo "❌ Error: Version disable requires interactive mode"
        echo "💡 Run this command in an interactive terminal"
        exit 1
    fi
fi
# Check if versioning is enabled
if [ ! -f "VERSION" ]; then
    echo "ℹ️  Version tracking is not enabled"
    echo "💡 Nothing to disable"
    exit 0
fi

CURRENT_VERSION=$(cat VERSION 2>/dev/null || echo "unknown")
if [[ "$CURRENT_VERSION" == "unknown" || -z "$CURRENT_VERSION" ]]; then
    echo "⚠️  VERSION file is corrupted"
    echo "💡 Remove it manually: rm VERSION"
    exit 1
fi

echo "⚠️  Disable Version Tracking?"
echo "────────────────────────────────"
echo ""
echo "Current version: v$CURRENT_VERSION"
echo ""
echo "This will:"
echo "• Remove VERSION file"
echo "• Remove version commands"
echo "• Remove version badges from README"
echo "• Keep CHANGELOG.md for history"
echo ""
echo "⚠️  You can re-enable versioning anytime with /flowforge:version:enable"
echo ""

# Skip interactive mode in test environment
if [[ "${FLOWFORGE_TEST:-}" == "true" ]]; then
    echo "Skipping interactive mode in test environment"
    REPLY="Y"
else
    # Handle user confirmation
    if [[ -n "${AUTO_CONFIRM:-}" ]] || [[ "${YES:-}" == "true" ]]; then
        REPLY="Y"
    else
        read -p "Proceed with disabling versioning? [y/N] " -n 1 -r
        echo
    fi
fi

if [[ ! ${REPLY:-N} =~ ^[Yy]$ ]]; then
    echo "❌ Cancelled - versioning remains enabled"
    exit 0
fi
```

## 🗑️ Step 1: Remove Version Files
```bash
echo -e "\n🗑️  Removing version tracking files..."

# Remove VERSION file with error handling
if [ -f "VERSION" ]; then
    if rm VERSION 2>/dev/null; then
        echo "✅ Removed VERSION file"
    else
        echo "❌ Failed to remove VERSION file"
        echo "💡 Check file permissions"
        exit 1
    fi
fi

# Remove version commands with error handling
COMMANDS_DIR="${CLAUDE_COMMANDS_DIR:-.claude/commands}"

if [ -f "$COMMANDS_DIR/version.md" ]; then
    if rm "$COMMANDS_DIR/version.md" 2>/dev/null; then
        echo "✅ Removed /version command"
    else
        echo "⚠️  Could not remove /version command"
    fi
fi

if [ -f "$COMMANDS_DIR/versionBump.md" ]; then
    if rm "$COMMANDS_DIR/versionBump.md" 2>/dev/null; then
        echo "✅ Removed /versionBump command"
    else
        echo "⚠️  Could not remove /versionBump command"
    fi
fi
```

## 📝 Step 2: Update Documentation
```bash
echo -e "\n📝 Updating documentation..."

# Add note to CHANGELOG.md with error handling
if [ -f "CHANGELOG.md" ]; then
    # Create backup first
    cp CHANGELOG.md CHANGELOG.md.bak 2>/dev/null || true
    
    # Add a note at the top
    TEMP_FILE=$(mktemp)
    if {
        head -n 1 CHANGELOG.md
        echo ""
        echo "> **Note**: Version tracking was disabled on $(date +%Y-%m-%d). Historical version information is preserved below."
        echo ""
        tail -n +2 CHANGELOG.md
    } > "$TEMP_FILE" 2>/dev/null; then
        if mv "$TEMP_FILE" CHANGELOG.md 2>/dev/null; then
            echo "✅ Added note to CHANGELOG.md"
            rm -f CHANGELOG.md.bak 2>/dev/null
        else
            echo "⚠️  Could not update CHANGELOG.md"
            mv CHANGELOG.md.bak CHANGELOG.md 2>/dev/null || true
        fi
    else
        echo "⚠️  Could not create CHANGELOG update"
        rm -f "$TEMP_FILE" 2>/dev/null
    fi
fi

# Remove version badge from README with error handling
if [ -f "README.md" ]; then
    # Create backup
    cp README.md README.md.bak 2>/dev/null || true
    
    # Remove version badge line (handle different sed versions)
    if command -v gsed &>/dev/null; then
        SED_CMD="gsed"
    else
        SED_CMD="sed"
    fi
    
    if $SED_CMD -i.tmp '/\[!\[Version\]/d' README.md 2>/dev/null; then
        echo "✅ Removed version badge from README.md"
        rm -f README.md.tmp README.md.bak 2>/dev/null
    else
        echo "⚠️  Could not remove version badge from README.md"
        mv README.md.bak README.md 2>/dev/null || true
    fi
fi

# Update tasks.json if it exists
if [ -f ".flowforge/tasks.json" ]; then
    # Create backup
    cp .flowforge/tasks.json .flowforge/tasks.json.bak 2>/dev/null || true
    
    # Mark versioning as disabled in metadata
    if jq '.metadata.versionTracking.enabled = false' .flowforge/tasks.json > .flowforge/tasks.json.tmp 2>/dev/null; then
        mv .flowforge/tasks.json.tmp .flowforge/tasks.json
        echo "✅ Updated tasks.json"
        rm -f .flowforge/tasks.json.bak 2>/dev/null
    else
        echo "⚠️  Could not update tasks.json"
        mv .flowforge/tasks.json.bak .flowforge/tasks.json 2>/dev/null || true
    fi
fi
```

## 🪝 Step 3: Update Git Hooks
```bash
echo -e "\n🪝 Cleaning git hooks..."

# Remove version check from pre-commit hook
if [ -f ".git/hooks/pre-commit" ]; then
    # Create backup
    cp .git/hooks/pre-commit .git/hooks/pre-commit.bak 2>/dev/null || true
    
    # Remove the version check section
    if command -v gsed &>/dev/null; then
        SED_CMD="gsed"
    else
        SED_CMD="sed"
    fi
    
    if $SED_CMD -i.tmp '/# VERSION file check/,/^fi$/d' .git/hooks/pre-commit 2>/dev/null; then
        echo "✅ Removed version checks from pre-commit hook"
        rm -f .git/hooks/pre-commit.tmp .git/hooks/pre-commit.bak 2>/dev/null
    else
        echo "⚠️  Could not update pre-commit hook"
        mv .git/hooks/pre-commit.bak .git/hooks/pre-commit 2>/dev/null || true
    fi
fi
```

## 📋 Step 4: Final Summary
```bash
echo -e "\n📋 Creating summary of disabled versioning..."

# Save a record of when versioning was disabled
if [ -d ".flowforge" ] || mkdir -p .flowforge 2>/dev/null; then
    if cat > .flowforge/.versioning-disabled << EOF
Versioning Disabled: $(date +"%Y-%m-%d %H:%M")
Last Version: v$CURRENT_VERSION
Reason: User requested via /flowforge:version:disable command
To Re-enable: Run /flowforge:version:enable
EOF
    then
        echo "✅ Created disable record"
    else
        echo "⚠️  Could not create disable record"
    fi
else
    echo "⚠️  Could not create .flowforge directory"
fi

echo "✅ Version tracking has been disabled"
echo ""
echo "📁 What was done:"
echo "   • Removed VERSION file"
echo "   • Removed version commands"
echo "   • Updated documentation"
echo "   • Cleaned git hooks"
echo ""
echo "📚 What was preserved:"
echo "   • CHANGELOG.md (with historical versions)"
echo "   • Git tags (if any were created)"
echo "   • Commit history"
echo ""
echo "💡 To re-enable versioning: /flowforge:version:enable"
echo ""

# Check if we're in a git repository
if git rev-parse --git-dir >/dev/null 2>&1; then
    echo "📝 Don't forget to commit these changes:"
    echo "   git add -A"
    echo '   git commit -m "chore: disable version tracking"'
else
    echo "ℹ️  Not in a git repository - no commit needed"
fi
```

## 🔄 Re-enabling Versioning

If you want to re-enable versioning later:

1. Run `/flowforge:version:enable`
2. Choose whether to continue from the last version or start fresh
3. Version tracking will resume with all features

Your CHANGELOG.md history is always preserved, making it easy to pick up where you left off.