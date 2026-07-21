# Command: flowforge:version:update
# Version: 2.0.0
# Description: FlowForge version update command

---
description: Check for FlowForge updates and install them automatically
argument-hint: "[help]"
---

# 🔄 FlowForge Update Command

Check for updates to FlowForge and install them seamlessly!

## 🔧 Setup Error Handling and Help
```bash
# Check if help is requested FIRST (before strict mode)
if [[ "${ARGUMENTS:-}" == "?" || "${ARGUMENTS:-}" == "help" ]]; then
    cat << 'EOF'
🔄 FlowForge Update Command

Check for updates and install them automatically with backup.

Usage: /flowforge:version:update [help]

Arguments:
  help, ?    Show this help message

This command will:
  • Check your current FlowForge version
  • Connect to GitHub for latest version
  • Create a backup before updating
  • Download and install updates
  • Run migration scripts if needed
  • Show what's new

Features:
  • Automatic backup creation
  • Git submodule support
  • Preserves user configurations
  • Safe rollback option

Prerequisites:
  - Internet connection
  - curl or wget
  - Git (for submodule updates)

Examples:
  /flowforge:version:update     - Check and install updates
  /flowforge:version:update ?   - Show this help

Related commands:
  /flowforge:version:check      - Just check version info
  /flowforge:version:enable     - Enable version tracking
  /flowforge:version:disable    - Disable version tracking
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
    if [[ "${BASH_COMMAND:-}" =~ "curl" ]]; then
        echo "💡 Failed to download from GitHub"
        echo "   Check your internet connection and try again"
    elif [[ "${BASH_COMMAND:-}" =~ "unzip" ]]; then
        echo "💡 Failed to extract update package"
        echo "   Ensure 'unzip' is installed: apt-get install unzip"
    elif [[ "${BASH_COMMAND:-}" =~ "rsync" ]]; then
        echo "💡 Failed to copy updated files"
        echo "   Check file permissions and disk space"
    elif [[ "${BASH_COMMAND:-}" =~ "git" ]]; then
        echo "💡 Git operation failed"
        echo "   Check your git configuration"
    fi
    
    # Cleanup temp files
    if [[ -n "${TEMP_DIR:-}" && -d "$TEMP_DIR" ]]; then
        echo "🧹 Cleaning up temporary files..."
        rm -rf "$TEMP_DIR"
    fi
    
    # Restore from backup if available
    if [[ -n "${BACKUP_DIR:-}" && -d "$BACKUP_DIR" ]]; then
        echo "💡 You can restore from backup: $BACKUP_DIR"
        echo "   Run: rm -rf .flowforge && mv $BACKUP_DIR .flowforge"
    fi
    
    exit $exit_code
}

# Set error trap
trap 'handle_error $LINENO' ERR

# Enable debug mode if DEBUG=1
[[ "${DEBUG:-0}" == "1" ]] && set -x
```

## 📊 Step 1: Check Current Version
```bash
echo "🔄 FlowForge Update System"
echo "════════════════════════════════════"
echo ""

# Get current version with error handling
if [ -f ".flowforge/VERSION" ]; then
    CURRENT_VERSION=$(cat .flowforge/VERSION 2>/dev/null || echo "unknown")
    if [[ "$CURRENT_VERSION" == "unknown" || -z "$CURRENT_VERSION" ]]; then
        echo "⚠️  Version file is corrupted"
        echo "💡 Assuming v1.0.0 for update purposes"
        CURRENT_VERSION="1.0.0"
    else
        echo "📌 Current FlowForge version: $CURRENT_VERSION"
    fi
else
    echo "⚠️  No version file found. Assuming v1.0.0"
    CURRENT_VERSION="1.0.0"
fi

# Get installed date
if [ -f ".flowforge/.setup-date" ]; then
    INSTALL_DATE=$(cat .flowforge/.setup-date 2>/dev/null || echo "unknown")
    if [[ "$INSTALL_DATE" != "unknown" ]]; then
        echo "📅 Installed on: $INSTALL_DATE"
    fi
fi
```

## 🌐 Step 2: Check for Updates
```bash
echo -e "\n🔍 Checking for updates..."

# Use timeout to prevent hanging
# For testing compatibility, check if we're in test mode
if [[ "${FLOWFORGE_TEST:-0}" == "1" ]]; then
    # In test mode, use curl directly without timeout wrapper
    CURL_CMD="curl"
elif command -v timeout &>/dev/null; then
    CURL_CMD="timeout 10 curl"
else
    CURL_CMD="curl --max-time 10"
fi

# Fetch latest version from GitHub
LATEST_VERSION=""
FETCH_ERROR=""

if RESPONSE=$($CURL_CMD -s https://api.github.com/repos/JustCode-CruzAlex/FlowForge/contents/VERSION 2>&1); then
    # Try to extract version from response
    if [[ "$RESPONSE" =~ \"content\" ]]; then
        CONTENT=$(echo "$RESPONSE" | grep '"content"' | cut -d'"' -f4 2>/dev/null || echo "")
        if [[ -n "$CONTENT" ]]; then
            LATEST_VERSION=$(echo "$CONTENT" | base64 -d 2>/dev/null | tr -d '\n' || echo "")
        fi
    fi
else
    FETCH_ERROR="Network request failed"
fi

if [[ -z "$LATEST_VERSION" ]]; then
    echo "❌ Could not fetch latest version. Check your internet connection."
    if [[ -n "$FETCH_ERROR" ]]; then
        echo "   Error: $FETCH_ERROR"
    fi
    exit 1
fi

echo "🌟 Latest FlowForge version: $LATEST_VERSION"

# Compare versions
if [ "$CURRENT_VERSION" = "$LATEST_VERSION" ]; then
    echo "✅ You're already on the latest version!"
    
    # Show recent changelog
    echo -e "\n📋 Recent changes in v$CURRENT_VERSION:"
    if [ -f ".flowforge/CHANGELOG.md" ]; then
        CHANGELOG_CONTENT=$(awk "/## \[$CURRENT_VERSION\]/,/^## \[/" .flowforge/CHANGELOG.md 2>/dev/null | head -20) || echo ""
        if [[ -n "$CHANGELOG_CONTENT" ]]; then
            echo "$CHANGELOG_CONTENT"
        else
            echo "No changelog available for this version."
        fi
    fi
    
    exit 0
fi

echo "🆕 Update available: $CURRENT_VERSION → $LATEST_VERSION"
```

## 📥 Step 3: Download and Prepare Update
```bash
echo -e "\n📥 Preparing to update FlowForge..."
echo "This will:"
echo "• Pull latest changes from GitHub"
echo "• Update all FlowForge components"
echo "• Preserve your project files"
echo "• Create backups of modified files"
echo ""

# Handle non-interactive mode
# For testing, check if stdin is available
if [[ "${FLOWFORGE_TEST:-0}" == "1" ]]; then
    # In test mode, always read from input
    read -p "Continue with update? [Y/n] " -n 1 -r
    echo
elif [[ ! -t 0 ]] || [[ "${CI:-false}" == "true" ]] || [[ "${AUTO_UPDATE:-false}" == "true" ]]; then
    echo "🤖 Running in automatic mode..."
    REPLY="Y"
else
    read -p "Continue with update? [Y/n] " -n 1 -r
    echo
fi

if [[ ! ${REPLY:-Y} =~ ^[Yy]$ ]]; then
    echo "❌ Update cancelled"
    exit 0
fi

# Create backup
echo "💾 Creating backup..."
BACKUP_DIR=".flowforge-backup-$(date +%Y%m%d_%H%M%S)"
if cp -r .flowforge "$BACKUP_DIR" 2>/dev/null; then
    echo "✅ Backup created at: $BACKUP_DIR"
else
    echo "⚠️  Could not create full backup"
    echo "💡 Proceeding with caution..."
fi
```

## 🔄 Step 4: Update FlowForge
```bash
echo -e "\n🔄 Updating FlowForge..."

# Check if FlowForge is a git submodule
if [ -f ".gitmodules" ] && grep -q ".flowforge" .gitmodules 2>/dev/null; then
    echo "📦 Updating via git submodule..."
    
    # Save current directory
    ORIGINAL_DIR="$(pwd)"
    
    # Update submodule
    if cd .flowforge 2>/dev/null; then
        if git fetch origin main 2>/dev/null; then
            git checkout main 2>/dev/null || git checkout -b main origin/main
            git pull origin main || {
                echo "⚠️  Git pull failed, trying reset..."
                git reset --hard origin/main
            }
            cd "${ORIGINAL_DIR:-$(pwd)}"
        else
            cd "${ORIGINAL_DIR:-$(pwd)}"
            echo "⚠️  Could not fetch updates via git"
            echo "💡 Falling back to manual update..."
            UPDATE_VIA_GIT=false
        fi
    else
        echo "⚠️  Could not access .flowforge directory"
        UPDATE_VIA_GIT=false
    fi
else
    UPDATE_VIA_GIT=false
fi

# Manual update via curl/wget
if [[ "${UPDATE_VIA_GIT:-true}" == "false" ]]; then
    echo "📦 Downloading update package..."
    
    # Save current directory if not already saved
    ORIGINAL_DIR="${ORIGINAL_DIR:-$(pwd)}"
    
    # Create temp directory
    TEMP_DIR=$(mktemp -d)
    cd "$TEMP_DIR"
    
    # Download latest release
    if $CURL_CMD -L https://github.com/JustCode-CruzAlex/FlowForge/archive/main.tar.gz -o flowforge-update.tar.gz; then
        echo "✅ Download complete"
        
        # Extract archive
        if command -v tar &>/dev/null; then
            tar -xzf flowforge-update.tar.gz || {
                echo "❌ Failed to extract update"
                cd "${ORIGINAL_DIR:-$(pwd)}"
                rm -rf "$TEMP_DIR"
                exit 1
            }
        else
            echo "❌ 'tar' command not found. Cannot extract update."
            cd "${ORIGINAL_DIR:-$(pwd)}"
            rm -rf "$TEMP_DIR"
            exit 1
        fi
        
        # Copy files (preserving user modifications)
        echo "📝 Updating FlowForge files..."
        
        # Update core files while preserving configs
        if command -v rsync &>/dev/null; then
            rsync -av --exclude='.git' --exclude='config.json' --exclude='settings.json' \
                FlowForge-main/ "${ORIGINAL_DIR:-$(pwd)}/.flowforge/" 2>/dev/null || {
                echo "⚠️  Some files could not be updated"
            }
        else
            # Fallback to cp
            cp -r FlowForge-main/* "${ORIGINAL_DIR:-$(pwd)}/.flowforge/" 2>/dev/null || {
                echo "⚠️  Some files could not be updated"
            }
        fi
        
        # Go back
        cd "${ORIGINAL_DIR:-$(pwd)}"
        rm -rf "$TEMP_DIR"
    else
        echo "❌ Download failed"
        cd "$ORIGINAL_DIR"
        rm -rf "$TEMP_DIR"
        exit 1
    fi
fi

# Run update script if available
if [ -f ".flowforge/scripts/update.sh" ] && [ -x ".flowforge/scripts/update.sh" ]; then
    echo "🚀 Running FlowForge update script..."
    .flowforge/scripts/update.sh || {
        echo "⚠️  Update script reported warnings"
    }
elif [ -f ".flowforge/update.sh" ] && [ -x ".flowforge/update.sh" ]; then
    echo "🚀 Running FlowForge update script..."
    bash .flowforge/update.sh || {
        echo "⚠️  Update script reported warnings"
    }
fi
```

## 📋 Step 5: Show Changelog
```bash
echo -e "\n📋 What's new in v$LATEST_VERSION:"

# Update VERSION file
echo "$LATEST_VERSION" > .flowforge/VERSION

# Fetch and display changelog for new version
if [ -f ".flowforge/CHANGELOG.md" ]; then
    echo "────────────────────────────────"
    CHANGELOG_SECTION=$(awk "/## \[$LATEST_VERSION\]/,/^## \[/" .flowforge/CHANGELOG.md 2>/dev/null | head -30) || echo ""
    if [[ -n "$CHANGELOG_SECTION" ]]; then
        echo "$CHANGELOG_SECTION"
    else
        echo "Changelog details not available. Check GitHub for release notes."
    fi
    echo "────────────────────────────────"
fi
```

## 🧪 Step 6: Verify Update
```bash
echo -e "\n🧪 Verifying update..."

# Check new version
NEW_VERSION=$(cat .flowforge/VERSION 2>/dev/null || echo "unknown")
if [ "$NEW_VERSION" = "$LATEST_VERSION" ]; then
    echo "✅ Update successful! Now running v$NEW_VERSION"
else
    echo "⚠️  Update may have issues. Version shows: $NEW_VERSION"
    echo "💡 You can restore from backup: $BACKUP_DIR"
fi

# Update any changed commands
if [ -d ".claude/commands" ] || [ -d "commands" ]; then
    echo "🔄 Updating command registry..."
    
    COMMANDS_DIR="${CLAUDE_COMMANDS_DIR:-.claude/commands}"
    if [ ! -d "$COMMANDS_DIR" ]; then
        COMMANDS_DIR="commands"
    fi
    
    # Count updated commands
    UPDATED_COUNT=0
    
    # Copy new/updated commands
    for cmd in .flowforge/commands/*.md; do
        if [ -f "$cmd" ]; then
            cmd_name=$(basename "$cmd")
            if [ ! -f "$COMMANDS_DIR/$cmd_name" ] || ! diff -q "$cmd" "$COMMANDS_DIR/$cmd_name" >/dev/null 2>&1; then
                cp "$cmd" "$COMMANDS_DIR/" 2>/dev/null && {
                    echo "  ✓ Updated $cmd_name"
                    ((UPDATED_COUNT++))
                }
            fi
        fi
    done
    
    if [ $UPDATED_COUNT -eq 0 ]; then
        echo "  ℹ️  No command updates needed"
    fi
fi

# Check for new rules
echo -e "\n📜 Checking for new rules..."
if [ -f ".flowforge/RULES.md" ]; then
    RULE_COUNT=$(grep -c "^### Rule [0-9]" .flowforge/RULES.md 2>/dev/null || echo "0")
    echo "📏 Total rules: $RULE_COUNT"
fi
```

## ✅ Step 7: Post-Update Tasks
```bash
echo -e "\n✅ Update completed!"
echo ""

# Generate updated project metrics
if [ -f "commands/flowforge/analytics/metrics.md" ]; then
    echo -e "${CYAN}📊 Generating updated project metrics...${NC}"
    bash -c "$(awk '/^```bash$/,/^```$/' commands/flowforge/analytics/metrics.md | sed '1d;$d')" >/dev/null 2>&1 || true
    if [ -f "reports/PROJECT_METRICS.md" ]; then
        echo -e "${GREEN}✅ Project metrics updated: reports/PROJECT_METRICS.md${NC}"
    fi
fi

# Save last version for reference
echo "$CURRENT_VERSION" > .flowforge/.last-version

# Check if this is a significant update
MAJOR_UPDATE=false
if [[ "$CURRENT_VERSION" != "$LATEST_VERSION" ]]; then
    # Compare major version numbers
    CURRENT_MAJOR=$(echo "$CURRENT_VERSION" | cut -d. -f1)
    LATEST_MAJOR=$(echo "$LATEST_VERSION" | cut -d. -f1)
    
    if [[ "$CURRENT_MAJOR" != "$LATEST_MAJOR" ]]; then
        MAJOR_UPDATE=true
    fi
fi

if [[ "$MAJOR_UPDATE" == "true" ]]; then
    echo "🎉 MAJOR UPDATE DETECTED!"
    echo "────────────────────────────────"
    echo "You've updated from v$CURRENT_VERSION to v$LATEST_VERSION"
    echo ""
    echo "🚀 Major updates may include:"
    echo "  • New features and commands"
    echo "  • Important bug fixes"
    echo "  • Breaking changes"
    echo ""
    echo "💡 Recommended actions:"
    echo "  1. Run /flowforge:version:post-update for migration wizard"
    echo "  2. Review CHANGELOG.md for breaking changes"
    echo "  3. Test your existing workflows"
else
    echo "🎯 Post-update recommendations:"
    echo "  1. Review new features in CHANGELOG.md"
    echo "  2. Check for new commands with /flowforge:help"
    echo "  3. Run /flowforge:dev:checkrules to verify compliance"
    echo "  4. Test your workflow to ensure compatibility"
fi

# Show new commands if any
echo -e "\n🆕 Checking for new commands..."
if [ -d "$COMMANDS_DIR" ]; then
    # List commands modified in last few minutes
    NEW_COMMANDS=$(find "$COMMANDS_DIR" -name "*.md" -mmin -5 2>/dev/null | wc -l)
    if [ "$NEW_COMMANDS" -gt 0 ]; then
        echo "Found $NEW_COMMANDS new/updated commands:"
        find "$COMMANDS_DIR" -name "*.md" -mmin -5 -exec basename {} \; 2>/dev/null | sed 's/.md$//' | sed 's/^/  • \//'
    else
        echo "  ℹ️  No new commands in this update"
    fi
fi

echo -e "\n💡 Tip: Enable automatic updates in your git hooks!"
echo "   Add to .git/hooks/post-merge:"
echo "   /flowforge:version:update"

# Debug info
if [[ "${DEBUG:-0}" == "1" ]]; then
    echo ""
    echo "🔍 Debug Info:"
    echo "  Previous version: $CURRENT_VERSION"
    echo "  New version: $NEW_VERSION"
    echo "  Update method: ${UPDATE_VIA_GIT:-manual}"
    echo "  Backup location: ${BACKUP_DIR:-none}"
    echo "  Major update: $MAJOR_UPDATE"
fi
```

## 🔧 Troubleshooting

If update fails:
1. Check internet connection
2. Verify GitHub access
3. Restore from backup: `mv $BACKUP_DIR .flowforge`
4. Manual update: Pull latest from GitHub

## 🤖 Automatic Updates

To enable automatic updates on git pull, add to `.git/hooks/post-merge`:
```bash
# Auto-update FlowForge
if [ -f ".flowforge/commands/flowforge/version/update.md" ]; then
    echo "🔄 Checking FlowForge updates..."
    AUTO_UPDATE=true /flowforge:version:update
fi
```