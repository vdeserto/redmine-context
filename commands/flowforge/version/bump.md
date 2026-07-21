# Command: flowforge:version:bump
# Version: 2.0.0
# Description: FlowForge version bump command

# 🚀 FlowForge Version Bump Command

Intelligent version management with manual, guided, and automatic modes.

## 🔧 Pre-flight Setup
```bash
set -euo pipefail

# Error handler
handle_error() {
    local exit_code=$?
    local line_number=$1
    echo "❌ Error on line $line_number (exit code: $exit_code)"
    exit $exit_code
}
trap 'handle_error $LINENO' ERR

# Enable debug if requested
[[ "${DEBUG:-0}" == "1" ]] && set -x
```

## 📚 Help System
```bash
# Check for help request
if [[ "${ARGUMENTS:-}" == "?" || "${ARGUMENTS:-}" == "help" ]]; then
    cat << 'HELP'
🚀 FlowForge Version Bump

Intelligent version management with multiple modes.

Usage:
  /flowforge:version:bump manual <version>  # Force specific version
  /flowforge:version:bump suggest           # Get AI recommendation
  /flowforge:version:bump auto              # Automatic detection
  /flowforge:version:bump --dry-run [mode]  # Test without changes

Examples:
  /flowforge:version:bump manual 1.4.0
  /flowforge:version:bump suggest
  /flowforge:version:bump auto
  /flowforge:version:bump --dry-run auto

Modes:
  manual  - You specify exact version
  suggest - AI analyzes and recommends
  auto    - System decides based on context

Options:
  --dry-run  Preview changes without applying
  --force    Skip confirmation prompts
  help, ?    Show this help

Version Format:
  MAJOR.MINOR.PATCH (e.g., 1.4.0)
  
Decision Factors:
  - Git branch type (feature/bugfix/hotfix)
  - Commit messages and types
  - Milestone metadata
  - Breaking changes detection
  - Current version state

Updates:
  - VERSION file
  - .flowforge-version.json
  - CHANGELOG.md
  - Git tags (optional)
HELP
    exit 0
fi
```

## 🔍 Parse Arguments
```bash
echo "🚀 FlowForge Version Bump"
echo "════════════════════════════════════════"

# Parse arguments
DRY_RUN=false
FORCE=false
MODE=""
VERSION=""

# Process arguments
ARGS=($ARGUMENTS)
for i in "${!ARGS[@]}"; do
    case "${ARGS[$i]}" in
        --dry-run)
            DRY_RUN=true
            echo "🔍 DRY RUN MODE - No changes will be made"
            ;;
        --force)
            FORCE=true
            ;;
        manual|suggest|auto)
            MODE="${ARGS[$i]}"
            # If manual mode, get version from next argument
            if [[ "$MODE" == "manual" ]] && [[ $((i+1)) -lt ${#ARGS[@]} ]]; then
                VERSION="${ARGS[$((i+1))]}"
            fi
            ;;
    esac
done

# Default to suggest mode if no mode specified
if [ -z "$MODE" ]; then
    MODE="suggest"
    echo "ℹ️  No mode specified, defaulting to 'suggest'"
fi

echo "📊 Mode: $MODE"
[ "$DRY_RUN" = true ] && echo "🔍 Dry run enabled"
[ "$FORCE" = true ] && echo "⚡ Force mode enabled"
```

## 🔍 Version Detection Functions
```bash
# Get current version
get_current_version() {
    if [ -f "VERSION" ]; then
        cat VERSION | tr -d '\n'
    elif [ -f ".flowforge-version.json" ]; then
        grep -o '"version":[[:space:]]*"[^"]*"' .flowforge-version.json | 
            sed 's/"version":[[:space:]]*"//' | tr -d '"'
    else
        echo "1.0.0"  # Default starting version
    fi
}

# Validate semantic version
validate_version() {
    local version=$1
    if [[ ! "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
        echo "❌ Invalid version format: $version"
        echo "💡 Use format: MAJOR.MINOR.PATCH (e.g., 1.4.0)"
        return 1
    fi
    return 0
}

# Get branch type
get_branch_type() {
    local branch=$(git branch --show-current)
    if [[ "$branch" =~ ^feature/ ]]; then
        echo "feature"
    elif [[ "$branch" =~ ^bugfix/|^fix/ ]]; then
        echo "bugfix"
    elif [[ "$branch" =~ ^hotfix/ ]]; then
        echo "hotfix"
    elif [[ "$branch" =~ ^release/ ]]; then
        echo "release"
    else
        echo "other"
    fi
}

# Analyze recent commits
analyze_commits() {
    local breaking=false
    local features=0
    local fixes=0
    
    # Check commits since last tag or last 20 commits
    local last_tag=$(git describe --tags --abbrev=0 2>/dev/null || echo "HEAD~20")
    
    while IFS= read -r commit; do
        if [[ "$commit" =~ BREAKING[[:space:]]CHANGE|breaking: ]]; then
            breaking=true
        fi
        if [[ "$commit" =~ ^feat|^feature ]]; then
            ((features++))
        fi
        if [[ "$commit" =~ ^fix|^bugfix ]]; then
            ((fixes++))
        fi
    done < <(git log "$last_tag"..HEAD --pretty=format:"%s" 2>/dev/null || true)
    
    echo "breaking=$breaking features=$features fixes=$fixes"
}

# Get milestone version hint
get_milestone_version() {
    if [ -f ".flowforge/tasks.json" ]; then
        # Get the active milestone version
        jq -r '.milestones | to_entries | map(select(.value.status == "active")) | .[0].value.version // empty' .flowforge/tasks.json 2>/dev/null || true
    fi
}

CURRENT_VERSION=$(get_current_version)
echo "📌 Current version: $CURRENT_VERSION"
```

## 🎯 Manual Mode
```bash
if [[ "$MODE" == "manual" ]]; then
    echo ""
    echo "📝 Manual Version Bump"
    echo "────────────────────────"
    
    if [ -z "$VERSION" ]; then
        echo "❌ Version required for manual mode"
        echo "💡 Usage: /flowforge:version:bump manual 1.4.0"
        exit 1
    fi
    
    # Validate version
    if ! validate_version "$VERSION"; then
        exit 1
    fi
    
    # Check if going backwards
    if [[ "$VERSION" < "$CURRENT_VERSION" ]]; then
        echo "⚠️  Warning: New version ($VERSION) is lower than current ($CURRENT_VERSION)"
        if [ "$FORCE" != true ]; then
            echo -n "Continue anyway? [y/N] "
            read -r response
            if [[ ! "$response" =~ ^[Yy]$ ]]; then
                echo "❌ Version bump cancelled"
                exit 0
            fi
        fi
    fi
    
    FINAL_VERSION="$VERSION"
    echo "✅ Version will be set to: $FINAL_VERSION"
fi
```

## 🤖 Suggest Mode
```bash
if [[ "$MODE" == "suggest" ]]; then
    echo ""
    echo "🤖 Analyzing project for version suggestion..."
    echo "────────────────────────────────────────────"
    
    # Parse current version
    IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT_VERSION"
    
    # Get analysis data
    BRANCH_TYPE=$(get_branch_type)
    eval $(analyze_commits)
    MILESTONE_VERSION=$(get_milestone_version)
    
    echo "📊 Analysis Results:"
    echo "  • Branch type: $BRANCH_TYPE"
    echo "  • Breaking changes: $breaking"
    echo "  • New features: $features"
    echo "  • Bug fixes: $fixes"
    [ -n "$MILESTONE_VERSION" ] && echo "  • Milestone suggests: $MILESTONE_VERSION"
    
    # Determine suggested version
    SUGGESTED_VERSION=""
    REASON=""
    
    if [ "$breaking" = true ]; then
        SUGGESTED_VERSION="$((MAJOR + 1)).0.0"
        REASON="Breaking changes detected → Major version bump"
    elif [ "$features" -gt 0 ]; then
        SUGGESTED_VERSION="$MAJOR.$((MINOR + 1)).0"
        REASON="$features new feature(s) → Minor version bump"
    elif [ "$fixes" -gt 0 ]; then
        SUGGESTED_VERSION="$MAJOR.$MINOR.$((PATCH + 1))"
        REASON="$fixes bug fix(es) → Patch version bump"
    else
        # Default to patch bump
        SUGGESTED_VERSION="$MAJOR.$MINOR.$((PATCH + 1))"
        REASON="No specific changes detected → Default patch bump"
    fi
    
    # Consider milestone version if available
    if [ -n "$MILESTONE_VERSION" ] && [ "$MILESTONE_VERSION" != "$CURRENT_VERSION" ]; then
        echo ""
        echo "💡 Milestone suggests version: $MILESTONE_VERSION"
        echo "   AI suggests version: $SUGGESTED_VERSION"
        
        # Use milestone if it's higher
        if [[ "$MILESTONE_VERSION" > "$SUGGESTED_VERSION" ]]; then
            SUGGESTED_VERSION="$MILESTONE_VERSION"
            REASON="Milestone target version"
        fi
    fi
    
    echo ""
    echo "🎯 Suggested version: $SUGGESTED_VERSION"
    echo "📝 Reason: $REASON"
    
    if [ "$FORCE" != true ] && [ "$DRY_RUN" != true ]; then
        echo ""
        echo -n "Accept this version? [Y/n] "
        read -r response
        if [[ "$response" =~ ^[Nn]$ ]]; then
            echo -n "Enter custom version: "
            read -r custom_version
            if validate_version "$custom_version"; then
                FINAL_VERSION="$custom_version"
            else
                echo "❌ Invalid version. Version bump cancelled"
                exit 1
            fi
        else
            FINAL_VERSION="$SUGGESTED_VERSION"
        fi
    else
        FINAL_VERSION="$SUGGESTED_VERSION"
    fi
fi
```

## 🚀 Auto Mode
```bash
if [[ "$MODE" == "auto" ]]; then
    echo ""
    echo "🚀 Automatic Version Detection"
    echo "────────────────────────────────"
    
    # Use same logic as suggest but apply automatically
    IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT_VERSION"
    
    BRANCH_TYPE=$(get_branch_type)
    eval $(analyze_commits)
    MILESTONE_VERSION=$(get_milestone_version)
    
    echo "📊 Auto-detection results:"
    echo "  • Branch: $BRANCH_TYPE"
    echo "  • Changes: $features features, $fixes fixes, breaking=$breaking"
    
    # Auto determine version
    if [ "$breaking" = true ]; then
        FINAL_VERSION="$((MAJOR + 1)).0.0"
        echo "  • Decision: Major bump (breaking changes)"
    elif [ "$features" -gt 0 ]; then
        FINAL_VERSION="$MAJOR.$((MINOR + 1)).0"
        echo "  • Decision: Minor bump (new features)"
    elif [ "$fixes" -gt 0 ]; then
        FINAL_VERSION="$MAJOR.$MINOR.$((PATCH + 1))"
        echo "  • Decision: Patch bump (bug fixes)"
    else
        FINAL_VERSION="$MAJOR.$MINOR.$((PATCH + 1))"
        echo "  • Decision: Patch bump (default)"
    fi
    
    # Override with milestone if higher
    if [ -n "$MILESTONE_VERSION" ] && [[ "$MILESTONE_VERSION" > "$FINAL_VERSION" ]]; then
        FINAL_VERSION="$MILESTONE_VERSION"
        echo "  • Override: Using milestone version"
    fi
    
    echo ""
    echo "✅ Auto-selected version: $FINAL_VERSION"
fi
```

## 📝 Apply Version Changes
```bash
echo ""
echo "📝 Applying Version Changes"
echo "════════════════════════════════════════"

if [ "$DRY_RUN" = true ]; then
    echo "🔍 DRY RUN - Changes that would be made:"
    echo ""
    echo "📄 Files to update:"
    echo "  • VERSION: $CURRENT_VERSION → $FINAL_VERSION"
    echo "  • .flowforge-version.json: Update version field"
    echo "  • CHANGELOG.md: Add new version entry"
    echo ""
    echo "🏷️  Git operations:"
    echo "  • Commit: 'chore: Bump version to $FINAL_VERSION'"
    echo "  • Tag: v$FINAL_VERSION (if on main/master)"
    echo ""
    echo "✅ Dry run complete - no changes made"
    exit 0
fi

# Update VERSION file
echo "📄 Updating VERSION file..."
echo "$FINAL_VERSION" > VERSION

# Update .flowforge-version.json if it exists
if [ -f ".flowforge-version.json" ]; then
    echo "📄 Updating .flowforge-version.json..."
    # Use sed to update version field
    if [[ "$OSTYPE" == "darwin"* ]]; then
        # macOS
        sed -i '' "s/\"version\":[[:space:]]*\"[^\"]*\"/\"version\": \"$FINAL_VERSION\"/" .flowforge-version.json
    else
        # Linux
        sed -i "s/\"version\":[[:space:]]*\"[^\"]*\"/\"version\": \"$FINAL_VERSION\"/" .flowforge-version.json
    fi
fi

# Update CHANGELOG.md
echo "📄 Updating CHANGELOG.md..."
if [ ! -f "CHANGELOG.md" ]; then
    cat > CHANGELOG.md << EOF
# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

EOF
fi

# Add new version entry to CHANGELOG
TEMP_FILE=$(mktemp)
cat > "$TEMP_FILE" << EOF
## [$FINAL_VERSION] - $(date +%Y-%m-%d)

### Added
- Version bumped via FlowForge automation

### Changed
- Version updated from $CURRENT_VERSION to $FINAL_VERSION

### Fixed
<!-- Add fixed items here -->

EOF

# Prepend to CHANGELOG after header
if grep -q "## \[" CHANGELOG.md; then
    # Insert before first version entry
    awk '/^## \[/ && !found {print "'"$(cat $TEMP_FILE)"'"; found=1} 1' CHANGELOG.md > CHANGELOG.tmp
    mv CHANGELOG.tmp CHANGELOG.md
else
    # Append after header if no versions yet
    cat CHANGELOG.md "$TEMP_FILE" > CHANGELOG.tmp
    mv CHANGELOG.tmp CHANGELOG.md
fi
rm -f "$TEMP_FILE"

echo "✅ Files updated successfully"
```

## 🎯 Git Operations
```bash
echo ""
echo "🏷️  Git Operations"
echo "────────────────────"

# Check if we have changes to commit
if git diff --quiet VERSION .flowforge-version.json CHANGELOG.md 2>/dev/null; then
    echo "ℹ️  No changes detected"
else
    echo "📝 Creating commit..."
    git add VERSION .flowforge-version.json CHANGELOG.md 2>/dev/null || true
    
    COMMIT_MSG="chore: Bump version to $FINAL_VERSION

- Previous version: $CURRENT_VERSION
- New version: $FINAL_VERSION
- Mode: $MODE
- Branch: $(git branch --show-current)"
    
    git commit -m "$COMMIT_MSG"
    echo "✅ Changes committed"
    
    # Suggest tagging if on main branch
    CURRENT_BRANCH=$(git branch --show-current)
    if [[ "$CURRENT_BRANCH" == "main" ]] || [[ "$CURRENT_BRANCH" == "master" ]]; then
        echo ""
        echo "💡 You're on the main branch. Consider creating a tag:"
        echo "   git tag -a v$FINAL_VERSION -m \"Release version $FINAL_VERSION\""
        echo "   git push origin v$FINAL_VERSION"
    fi
fi
```

## ✅ Success!
```bash
echo ""
echo "════════════════════════════════════════"
echo "✅ Version Bump Complete!"
echo "════════════════════════════════════════"
echo ""
echo "📊 Summary:"
echo "  • Previous: $CURRENT_VERSION"
echo "  • New: $FINAL_VERSION"
echo "  • Mode: $MODE"
echo ""
echo "📄 Updated files:"
echo "  • VERSION"
[ -f ".flowforge-version.json" ] && echo "  • .flowforge-version.json"
echo "  • CHANGELOG.md"
echo ""
echo "🚀 Next steps:"
echo "  1. Review CHANGELOG.md and add details"
echo "  2. Test your changes"
echo "  3. Push to remote: git push"
[ "$CURRENT_BRANCH" == "main" ] && echo "  4. Create release tag: git tag v$FINAL_VERSION"
echo ""
echo "💡 Tip: Use --dry-run to preview changes before applying"

exit 0
```

**Created by FlowForge Version Automation System**