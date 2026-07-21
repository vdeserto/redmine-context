# Command: flowforge:version:enable
# Version: 2.0.0
# Description: FlowForge version enable command

---
description: Enable version tracking for your project with automatic changelog generation
argument-hint: "[help]"
---

# 🔢 Enable Project Versioning

This command enables semantic versioning for your project, following the same standards as FlowForge itself.

## 📋 What This Does

When you enable versioning:
1. Creates VERSION file with initial version (0.0.1)
2. Sets up automatic CHANGELOG.md generation
3. Links versions to milestones/sprints
4. Adds version bump commands to your workflow
5. Integrates with your planning system

## ⚡ Quick Enable
```bash
# Check if help is requested FIRST (before strict mode)
if [[ "${ARGUMENTS:-}" == "?" || "${ARGUMENTS:-}" == "help" ]]; then
    cat << 'EOF'
🔢 Enable Version Tracking

Enable semantic versioning for your project with automatic changelog.

Usage: /flowforge:version:enable [help]

Arguments:
  help, ?    Show this help message

This command will:
  • Create VERSION file (0.0.1)
  • Set up CHANGELOG.md
  • Add version commands
  • Link to planning system
  • Update git hooks
  • Add README badge

Prerequisites:
  - Git repository
  - Write permissions
  - Interactive terminal

Examples:
  /flowforge:version:enable     - Enable versioning
  /flowforge:version:enable ?   - Show this help

Related commands:
  /flowforge:version:check      - Check current version
  /flowforge:version:update     - Update FlowForge
  /flowforge:version:disable    - Disable versioning
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
    if [[ "${BASH_COMMAND:-}" =~ "echo.*>.*VERSION" ]]; then
        echo "💡 Failed to create VERSION file"
        echo "   Check write permissions in current directory"
    elif [[ "${BASH_COMMAND:-}" =~ "cat.*>.*CHANGELOG" ]]; then
        echo "💡 Failed to create CHANGELOG.md"
        echo "   Check write permissions"
    elif [[ "${BASH_COMMAND:-}" =~ "git" ]]; then
        echo "💡 Git operation failed"
        echo "   Ensure you're in a git repository"
    elif [[ "${BASH_COMMAND:-}" =~ "mkdir" ]]; then
        echo "💡 Failed to create directory"
        echo "   Check file permissions"
    fi
    
    echo ""
    echo "💡 To enable version tracking manually:"
    echo "   1. Create VERSION file: echo '0.0.1' > VERSION"
    echo "   2. Create CHANGELOG.md"
    echo "   3. Add version commands to .claude/commands/"
    
    exit $exit_code
}

# Set error trap
trap 'handle_error $LINENO' ERR

# Enable debug mode if DEBUG=1
[[ "${DEBUG:-0}" == "1" ]] && set -x

# Handle non-interactive mode (skip for testing)
if [[ "${FLOWFORGE_TEST:-}" != "true" ]]; then
    if [[ ! -t 0 ]] || [[ "${CI:-false}" == "true" ]]; then
        echo "❌ Error: Version enable requires interactive mode"
        echo "💡 Run this command in an interactive terminal"
        exit 1
    fi
fi
# Check if versioning is already enabled
if [ -f "VERSION" ]; then
    CURRENT_VERSION=$(cat VERSION 2>/dev/null || echo "unknown")
    echo "✅ Versioning is already enabled!"
    echo "📌 Current version: $CURRENT_VERSION"
    echo ""
    echo "💡 Available commands:"
    echo "   • /version - Show current version"
    echo "   • /versionBump patch - Bump patch version (0.0.X)"
    echo "   • /versionBump minor - Bump minor version (0.X.0)"
    echo "   • /versionBump major - Bump major version (X.0.0)"
    echo "   • /flowforge:version:disable - Disable version tracking"
    exit 0
fi

echo "🔢 FlowForge Project Versioning Setup"
echo "────────────────────────────────"
echo ""
echo "This will enable semantic versioning (MAJOR.MINOR.PATCH) for your project."
echo "Versions will be linked to your milestones and tracked in CHANGELOG.md"
echo ""

# Handle user confirmation
if [[ "${FLOWFORGE_TEST:-}" == "true" ]]; then
    # Skip interactive mode in test environment
    echo "Skipping interactive mode in test environment"
    REPLY="Y"
elif [[ -n "${AUTO_CONFIRM:-}" ]] || [[ "${YES:-}" == "true" ]]; then
    REPLY="Y"
else
    read -p "Enable versioning? [Y/n] " -n 1 -r
    echo
fi

if [[ ! ${REPLY:-Y} =~ ^[Yy]$ ]]; then
    echo "❌ Versioning setup cancelled"
    exit 0
fi

echo "🏷️ Initializing version tracking..."

# Create VERSION file with error handling
if echo "0.0.1" > VERSION; then
    echo "✅ Created VERSION file with initial version 0.0.1"
else
    echo "❌ Failed to create VERSION file"
    echo "💡 Check write permissions in current directory"
    exit 1
fi

# Create or update CHANGELOG.md with error handling
if [ ! -f "CHANGELOG.md" ]; then
    if cat > CHANGELOG.md << 'EOF'
# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]
### Added
- Initial project setup with FlowForge
- Version tracking system

## [0.0.1] - $(date +%Y-%m-%d)
### Added
- Project initialization
- FlowForge integration
- Basic project structure

[Unreleased]: https://github.com/$(git config user.name 2>/dev/null || echo "username")/$(basename "$PWD")/compare/v0.0.1...HEAD
[0.0.1]: https://github.com/$(git config user.name 2>/dev/null || echo "username")/$(basename "$PWD")/releases/tag/v0.0.1
EOF
    then
        echo "✅ Created CHANGELOG.md"
    else
        echo "❌ Failed to create CHANGELOG.md"
        exit 1
    fi
else
    # Add versioning entry to existing changelog
    echo "📝 Updating existing CHANGELOG.md..."
    
    # Create backup first
    cp CHANGELOG.md CHANGELOG.md.bak 2>/dev/null || true
    
    # Insert after the header (handle different sed versions)
    if command -v gsed &>/dev/null; then
        SED_CMD="gsed"
    else
        SED_CMD="sed"
    fi
    
    if $SED_CMD -i.tmp '/^# Changelog/a\\n## [Unreleased]\n### Added\n- Version tracking system enabled\n' CHANGELOG.md 2>/dev/null; then
        echo "✅ Updated CHANGELOG.md"
        rm -f CHANGELOG.md.tmp 2>/dev/null
    else
        echo "⚠️  Could not update CHANGELOG.md automatically"
        echo "💡 Please add version tracking entry manually"
    fi
fi

echo -e "\n📁 Creating version management commands..."

# Ensure commands directory exists
COMMANDS_DIR="${CLAUDE_COMMANDS_DIR:-.claude/commands}"
if [ ! -d "$COMMANDS_DIR" ]; then
    if ! mkdir -p "$COMMANDS_DIR" 2>/dev/null; then
        echo "❌ Failed to create commands directory"
        echo "💡 Create it manually: mkdir -p $COMMANDS_DIR"
        exit 1
    fi
fi

# Create /version command
if cat > "$COMMANDS_DIR/version.md" << 'EOFVERSION'
---
description: Show current project version and recent changes
argument-hint: "(no arguments needed)"
---

# 📌 Project Version

\`\`\`bash
if [ ! -f "VERSION" ]; then
    echo "❌ Version tracking not enabled"
    echo "💡 Run /enableVersioning to start tracking versions"
    exit 1
fi

CURRENT_VERSION=$(cat VERSION)
echo "🔢 Current Version: v$CURRENT_VERSION"
echo ""

# Show recent changelog entries
echo "📋 Recent Changes:"
echo "────────────────────────────────"
awk '/^## \[/{if(++count>3)exit} /^## \[/,/^## \[/{if(p)print} {p=1}' CHANGELOG.md | head -20

echo ""
echo "💡 Commands:"
echo "   • /versionBump patch - For bug fixes (0.0.X)"
echo "   • /versionBump minor - For new features (0.X.0)"
echo "   • /versionBump major - For breaking changes (X.0.0)"
\`\`\`
EOFVERSION
then
    echo "✅ Created version command"
else
    echo "❌ Failed to create version command"
    exit 1
fi

# Create /versionBump command
if cat > "$COMMANDS_DIR/versionBump.md" << 'EOFBUMP'
---
description: Bump project version (patch, minor, or major)
argument-hint: "[patch|minor|major] - Type of version bump"
---

# 📈 Bump Project Version

\`\`\`bash
if [ ! -f "VERSION" ]; then
    echo "❌ Version tracking not enabled"
    echo "💡 Run /enableVersioning to start tracking versions"
    exit 1
fi

# Get bump type
BUMP_TYPE="${1:-patch}"
if [[ ! "$BUMP_TYPE" =~ ^(patch|minor|major)$ ]]; then
    echo "❌ Invalid bump type: $BUMP_TYPE"
    echo "💡 Use: patch, minor, or major"
    exit 1
fi

# Get current version
CURRENT_VERSION=$(cat VERSION)
IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT_VERSION"

# Calculate new version
case "$BUMP_TYPE" in
    patch)
        NEW_VERSION="$MAJOR.$MINOR.$((PATCH + 1))"
        ;;
    minor)
        NEW_VERSION="$MAJOR.$((MINOR + 1)).0"
        ;;
    major)
        NEW_VERSION="$((MAJOR + 1)).0.0"
        ;;
esac

echo "🔄 Version Bump: $BUMP_TYPE"
echo "   Current: v$CURRENT_VERSION"
echo "   New:     v$NEW_VERSION"
echo ""

# Get changelog entries
echo "📝 What's changed in this version?"
echo "Please provide a summary of changes (end with '.' on new line):"
CHANGES=""
while IFS= read -r line; do
    [[ "$line" == "." ]] && break
    CHANGES+="$line"$'\n'
done

# Update VERSION file
echo "$NEW_VERSION" > VERSION

# Update CHANGELOG.md
DATE=$(date +%Y-%m-%d)
TEMP_FILE=$(mktemp)

# Process changelog
awk -v version="$NEW_VERSION" -v date="$DATE" -v changes="$CHANGES" '
/^## \[Unreleased\]/ {
    print
    print ""
    print "## [" version "] - " date
    print changes
    next
}
{print}
' CHANGELOG.md > "$TEMP_FILE"

mv "$TEMP_FILE" CHANGELOG.md

# Update comparison links
PROJECT_NAME=$(basename $PWD)
GITHUB_USER=$(git config user.name)

# Add new comparison link
sed -i "/^\[Unreleased\]:/s|/v[0-9.]*\.\.\.|/v$NEW_VERSION...|" CHANGELOG.md

# Add version link
echo "[${NEW_VERSION}]: https://github.com/${GITHUB_USER}/${PROJECT_NAME}/compare/v${CURRENT_VERSION}...v${NEW_VERSION}" >> CHANGELOG.md

echo ""
echo "✅ Version bumped to v$NEW_VERSION"
echo "✅ CHANGELOG.md updated"
echo ""
echo "💡 Next steps:"
echo "   1. Review CHANGELOG.md"
echo "   2. Commit changes: git add VERSION CHANGELOG.md && git commit -m \"chore: bump version to v$NEW_VERSION\""
echo "   3. Tag release: git tag -a v$NEW_VERSION -m \"Version $NEW_VERSION\""
echo "   4. Push: git push && git push --tags"
\`\`\`
EOFBUMP
then
    echo "✅ Created versionBump command"
else
    echo "❌ Failed to create versionBump command"
    exit 1
fi

echo "✅ Version commands created"

echo -e "\n🔗 Linking version system to planning..."

# Check planning mode from tasks.json
if [ -f ".flowforge/tasks.json" ]; then
    # Check for sprint or milestone indicators in tasks.json
    if jq -e '.milestones | to_entries | .[0].key | contains("sprint")' .flowforge/tasks.json &>/dev/null; then
        PLANNING_MODE="sprint"
    else
        PLANNING_MODE="milestone"
    fi
    
    echo "📅 Detected $PLANNING_MODE-based planning"
    
    # Update tasks.json metadata with version tracking info
    jq --arg mode "$PLANNING_MODE" --arg date "$(date +%Y-%m-%d)" '
        .metadata.versionTracking = {
            "enabled": true,
            "currentVersion": "0.0.1",
            "enabledDate": $date,
            "versioning": "Semantic (X.Y.Z)",
            "strategy": $mode,
            "nextRelease": ("When current " + $mode + " completes")
        }' .flowforge/tasks.json > .flowforge/tasks.json.tmp && 
    mv .flowforge/tasks.json.tmp .flowforge/tasks.json && 
    echo "✅ Linked versioning to $PLANNING_MODE planning" || 
    echo "⚠️  Could not update tasks.json"
fi

echo -e "\n🪝 Updating git hooks for version awareness..."

# Add version check to pre-commit hook
if [ -f ".git/hooks/pre-commit" ]; then
    if ! grep -q "VERSION file check" .git/hooks/pre-commit 2>/dev/null; then
        if cat >> .git/hooks/pre-commit << 'EOF'

# VERSION file check
if [ -f "VERSION" ] && [ -f "CHANGELOG.md" ]; then
    # Check if VERSION or CHANGELOG changed
    if git diff --cached --name-only | grep -qE "^(VERSION|CHANGELOG.md)$"; then
        VERSION=$(cat VERSION)
        echo "📌 Version: v$VERSION"
        
        # Verify changelog has entry for version
        if git diff --cached --name-only | grep -q "VERSION"; then
            if ! grep -q "\[$VERSION\]" CHANGELOG.md; then
                echo "⚠️  Warning: VERSION changed but CHANGELOG.md has no entry for v$VERSION"
                echo "💡 Run /versionBump to properly update version"
            fi
        fi
    fi
fi
EOF
        then
            echo "✅ Updated pre-commit hook"
        else
            echo "⚠️  Could not update pre-commit hook"
        fi
    else
        echo "ℹ️  Pre-commit hook already has version check"
    fi
else
    echo "ℹ️  No pre-commit hook found, skipping hook update"
fi

echo -e "\n🏷️ Adding version badge to README..."

if [ -f "README.md" ]; then
    # Add version badge after the title
    if ! grep -q "img.shields.io/badge/version" README.md 2>/dev/null; then
        # Create backup
        cp README.md README.md.bak 2>/dev/null || true
        
        # Try to add badge (handle different sed versions)
        if command -v gsed &>/dev/null; then
            SED_CMD="gsed"
        else
            SED_CMD="sed"
        fi
        
        if $SED_CMD -i.tmp '0,/^$/s|^$|[![Version](https://img.shields.io/badge/version-0.0.1-blue.svg)](./CHANGELOG.md)\n|' README.md 2>/dev/null; then
            echo "✅ Added version badge to README.md"
            rm -f README.md.tmp 2>/dev/null
        else
            echo "⚠️  Could not add version badge automatically"
            echo "💡 Add manually: [![Version](https://img.shields.io/badge/version-0.0.1-blue.svg)](./CHANGELOG.md)"
        fi
    else
        echo "ℹ️  Version badge already exists in README.md"
    fi
else
    echo "ℹ️  No README.md found, skipping badge addition"
fi

echo -e "\n✅ Version tracking enabled successfully!"
echo ""
echo "📋 What's been set up:"
echo "   • VERSION file (0.0.1)"
echo "   • CHANGELOG.md structure"
echo "   • Version management commands"
echo "   • Planning system integration"
echo "   • Git hook awareness"
echo "   • README version badge"
echo ""
echo "🎯 Available commands:"
echo "   • /version - Show current version"
echo "   • /versionBump [patch|minor|major] - Bump version"
echo "   • /disableVersioning - Disable versioning"
echo ""
echo "📚 Versioning Guidelines:"
echo "   • PATCH (0.0.X) - Bug fixes, small changes"
echo "   • MINOR (0.X.0) - New features, non-breaking"
echo "   • MAJOR (X.0.0) - Breaking changes"
echo ""
echo "💡 Remember: Always update CHANGELOG.md when bumping versions!"

# Commit the changes (with error handling)
echo -e "\n🔀 Committing version tracking setup..."

# Check if we're in a git repository
if ! git rev-parse --git-dir >/dev/null 2>&1; then
    echo "⚠️  Not in a git repository, skipping commit"
    echo "💡 To commit manually:"
    echo "   git add VERSION CHANGELOG.md $COMMANDS_DIR/version*.md"
    echo "   git commit -m 'feat: enable project version tracking'"
else
    # Stage files
    FILES_TO_ADD="VERSION CHANGELOG.md"
    
    # Add command files if they exist
    if ls "$COMMANDS_DIR"/version*.md >/dev/null 2>&1; then
        FILES_TO_ADD="$FILES_TO_ADD $COMMANDS_DIR/version*.md"
    fi
    
    if git add $FILES_TO_ADD 2>/dev/null; then
        if git commit -m "feat: enable project version tracking

- Initialize version at 0.0.1
- Set up CHANGELOG.md
- Add version management commands
- Link to planning system
- Follow semantic versioning" 2>/dev/null; then
            echo "✅ Changes committed successfully"
        else
            echo "⚠️  Could not commit changes"
            echo "💡 You may need to commit manually"
        fi
    else
        echo "⚠️  Could not stage files for commit"
    fi
fi

echo -e "\n✅ Version tracking enabled successfully!"
echo ""
echo "📋 What's been set up:"
echo "   • VERSION file (0.0.1)"
echo "   • CHANGELOG.md structure"
echo "   • Version management commands"
if [ -f ".flowforge/tasks.json" ]; then
    echo "   • Planning system integration"
fi
if [ -f ".git/hooks/pre-commit" ] && grep -q "VERSION file check" .git/hooks/pre-commit 2>/dev/null; then
    echo "   • Git hook awareness"
fi
if [ -f "README.md" ] && grep -q "img.shields.io/badge/version" README.md 2>/dev/null; then
    echo "   • README version badge"
fi
echo ""
echo "🎯 Available commands:"
echo "   • /version - Show current version"
echo "   • /versionBump [patch|minor|major] - Bump version"
echo "   • /flowforge:version:disable - Disable versioning"
echo ""
echo "📚 Versioning Guidelines:"
echo "   • PATCH (0.0.X) - Bug fixes, small changes"
echo "   • MINOR (0.X.0) - New features, non-breaking"
echo "   • MAJOR (X.0.0) - Breaking changes"
echo ""
echo "💡 Remember: Always update CHANGELOG.md when bumping versions!"
```

## 📖 Semantic Versioning Guide

Your project now follows [Semantic Versioning](https://semver.org/):

- **MAJOR.MINOR.PATCH** (e.g., 1.2.3)
- **MAJOR**: Incompatible API changes
- **MINOR**: New functionality (backwards compatible)
- **PATCH**: Bug fixes (backwards compatible)

Version 0.y.z is for initial development. Anything may change at any time.
Version 1.0.0 defines the public API.