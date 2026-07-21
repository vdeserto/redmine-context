# Command: flowforge:version:check
# Version: 2.0.0
# Description: FlowForge version check command

---
description: Show FlowForge version and changelog information
argument-hint: "[help]"
---

# 🔢 FlowForge Version Information

## 🔧 Setup Error Handling and Help
```bash
# Check if help is requested FIRST (before strict mode)
if [[ "${ARGUMENTS:-}" == "?" || "${ARGUMENTS:-}" == "help" ]]; then
    cat << 'EOF'
🔢 FlowForge Version Information

Show current FlowForge version, check for updates, and view changelog.

Usage: /flowforge:version:check [help]

Arguments:
  help, ?    Show this help message

This command will:
  • Display current FlowForge version
  • Show installation date and type
  • Check for available updates
  • Display changelog information
  • Show version history

Features:
  • Automatic update detection
  • Changelog parsing
  • Git submodule support
  • Version comparison

Examples:
  /flowforge:version:check     - Show version info and check updates
  /flowforge:version:check ?   - Show this help

Related commands:
  /flowforge:version:update    - Update to latest version
  /flowforge:version:enable    - Enable version tracking
  /flowforge:version:disable   - Disable version tracking
EOF
    exit 0
fi

# Now enable strict error handling for the rest of the script
set -euo pipefail

# Error handler function
handle_error() {
    local exit_code=$?
    local line_number=$1
    echo "❌ Error on line $line_number (exit code: $exit_code)"
    
    # Provide helpful error messages based on context
    if [[ "${BASH_COMMAND:-}" =~ "curl" ]]; then
        echo "💡 Network request failed - check your internet connection"
    elif [[ "${BASH_COMMAND:-}" =~ "base64" ]]; then
        echo "💡 Failed to decode version information"
    elif [[ "${BASH_COMMAND:-}" =~ "awk" ]]; then
        echo "💡 Failed to parse changelog format"
    fi
    
    exit $exit_code
}

# Set error trap
trap 'handle_error $LINENO' ERR

# Enable debug mode if DEBUG=1
[[ "${DEBUG:-0}" == "1" ]] && set -x
```

## 📌 Current Version
```bash
# Display current FlowForge version
echo "🔢 FlowForge Version Information"
echo "════════════════════════════════════"
echo ""

if [ -f ".flowforge/VERSION" ]; then
    CURRENT_VERSION=$(cat .flowforge/VERSION 2>/dev/null || echo "unknown")
    if [[ "$CURRENT_VERSION" == "unknown" || -z "$CURRENT_VERSION" ]]; then
        echo "⚠️  Version file is corrupted or empty"
        echo "💡 Run /flowforge:version:update to fix"
        exit 1
    fi
    echo "🔥 FlowForge Version: $CURRENT_VERSION"
else
    echo "⚠️  Version file not found. You may be using FlowForge < 1.1.0"
    echo "💡 Run /update to upgrade to the latest version"
    exit 1
fi

# Show installation date if available
if [ -f ".flowforge/.setup-date" ]; then
    INSTALL_DATE=$(cat .flowforge/.setup-date 2>/dev/null || echo "unknown")
    if [[ "$INSTALL_DATE" != "unknown" ]]; then
        echo "📅 Installed on: $INSTALL_DATE"
    fi
fi

# Check if this is a git submodule
if [ -f ".gitmodules" ] && grep -q ".flowforge" .gitmodules 2>/dev/null; then
    echo "📦 Installation type: Git Submodule"
    
    # Show commit info with error handling
    if [ -d ".flowforge/.git" ]; then
        cd .flowforge
        COMMIT=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
        BRANCH=$(git branch --show-current 2>/dev/null || echo "unknown")
        echo "🔗 Commit: $COMMIT on branch $BRANCH"
        cd - > /dev/null
    fi
else
    echo "📦 Installation type: Manual"
fi
```

## 📋 Changelog for Current Version
```bash
echo -e "\n📋 What's in v$CURRENT_VERSION:"
echo "════════════════════════════════════════════"

# Display changelog for current version
if [ -f ".flowforge/CHANGELOG.md" ]; then
    # Extract the section for current version with error handling
    CHANGELOG_CONTENT=""
    # Use sed to extract content between version headers
    START_PATTERN="## \[$CURRENT_VERSION\]"
    if grep -q "$START_PATTERN" .flowforge/CHANGELOG.md 2>/dev/null; then
        # Get line number where this version starts
        START_LINE=$(grep -n "$START_PATTERN" .flowforge/CHANGELOG.md | cut -d: -f1)
        # Get line number where next version starts (or end of file)
        NEXT_LINE=$(tail -n +"$((START_LINE + 1))" .flowforge/CHANGELOG.md | grep -n "^## \[" | head -1 | cut -d: -f1 2>/dev/null || echo "")
        
        if [[ -n "$NEXT_LINE" ]]; then
            # Extract lines between start and next version
            END_LINE=$((START_LINE + NEXT_LINE - 1))
            sed -n "${START_LINE},${END_LINE}p" .flowforge/CHANGELOG.md
        else
            # Extract from start to end of file
            tail -n +"$START_LINE" .flowforge/CHANGELOG.md
        fi
    else
        echo "No specific changelog entry for v$CURRENT_VERSION"
    fi
else
    echo "Changelog not found. This version may not have detailed change information."
fi

echo "════════════════════════════════════════════"
```

## 🌐 Check for Updates
```bash
echo -e "\n🔍 Checking for updates..."

# Try to fetch latest version from GitHub with timeout
LATEST_VERSION=""
FETCH_ERROR=""

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
    echo "⚠️  Could not check for updates (no internet connection?)"
    if [[ -n "$FETCH_ERROR" ]]; then
        echo "   Error: $FETCH_ERROR"
    fi
else
    echo "🌟 Latest available: v$LATEST_VERSION"
    
    # Compare versions
    if [ "$CURRENT_VERSION" = "$LATEST_VERSION" ]; then
        echo "✅ You're on the latest version!"
    else
        echo "🆕 Update available: $CURRENT_VERSION → $LATEST_VERSION"
        echo ""
        echo "📥 To update, run: /update"
        
        # Show what's new in the latest version
        echo -e "\n🎯 What's new in v$LATEST_VERSION:"
        echo "────────────────────────────────────"
        
        # Try to fetch latest changelog with timeout
        if LATEST_CHANGELOG=$($CURL_CMD -s https://raw.githubusercontent.com/JustCode-CruzAlex/FlowForge/main/CHANGELOG.md 2>/dev/null); then
            if [[ -n "$LATEST_CHANGELOG" ]]; then
                CHANGELOG_SECTION=$(echo "$LATEST_CHANGELOG" | awk "/## \\[$LATEST_VERSION\\]/,/^## \\[/" 2>/dev/null | head -20)
                if [[ -n "$CHANGELOG_SECTION" ]]; then
                    echo "$CHANGELOG_SECTION"
                else
                    echo "Could not extract changelog for latest version."
                fi
            else
                echo "Could not fetch latest changelog."
            fi
        else
            echo "Could not fetch latest changelog. Check GitHub for details."
        fi
    fi
fi
```

## 🏗️ FlowForge Features
```bash
echo -e "\n🏗️ FlowForge Features in v$CURRENT_VERSION:"
echo "• 33 Development Rules for Excellence"
echo "• Automated Git Hooks & Enforcement"
echo "• Built-in Time Tracking"
echo "• Claude Code Integration"
echo "• Test-Driven Development Support"
echo "• Professional Documentation Templates"
echo "• Automatic Update System"
echo "• Project Version Management (v1.2.0+)"
echo "• Multi-Project Support (Umbrella Mode)"
```

## 📚 Version History
```bash
echo -e "\n📚 Recent Version History:"

if [ -f ".flowforge/CHANGELOG.md" ]; then
    # Show version list with error handling
    VERSION_COUNT=0
    while IFS= read -r line; do
        if [[ "$line" =~ ^##[[:space:]]\[ ]]; then
            VERSION=$(echo "$line" | sed -n 's/.*\[\([^]]*\)\].*/\1/p' 2>/dev/null || echo "")
            DATE=$(echo "$line" | sed -n 's/.*- \(.*\)/\1/p' 2>/dev/null || echo "")
            
            if [[ -n "$VERSION" ]]; then
                if [ "$VERSION" = "$CURRENT_VERSION" ]; then
                    echo "• v$VERSION - ${DATE:-Unknown date} ← Current"
                else
                    echo "• v$VERSION - ${DATE:-Unknown date}"
                fi
                
                ((VERSION_COUNT++)) || true
                if [ $VERSION_COUNT -ge 5 ]; then
                    break
                fi
            fi
        fi
    done < .flowforge/CHANGELOG.md
    
    if [ $VERSION_COUNT -eq 0 ]; then
        echo "No version entries found in changelog"
    fi
else
    echo "Version history not available"
fi
```

## 🔗 Resources
```bash
echo -e "\n🔗 Resources:"
echo "• GitHub: https://github.com/JustCode-CruzAlex/FlowForge"
echo "• Documentation: .flowforge/README.md"
echo "• Changelog: .flowforge/CHANGELOG.md"
echo "• Report Issues: gh issue create --repo JustCode-CruzAlex/FlowForge"

# Debug info
if [[ "${DEBUG:-0}" == "1" ]]; then
    echo ""
    echo "🔍 Debug Info:"
    echo "  Current version: ${CURRENT_VERSION:-none}"
    echo "  Latest version: ${LATEST_VERSION:-none}"
    echo "  Installation type: ${INSTALL_TYPE:-manual}"
    echo "  Has changelog: $([ -f ".flowforge/CHANGELOG.md" ] && echo "yes" || echo "no")"
fi
```

## 💡 Version Information

**Semantic Versioning**: FlowForge follows semantic versioning:
- **MAJOR.MINOR.PATCH** (e.g., 1.2.0)
- **MAJOR**: Incompatible API changes
- **MINOR**: New functionality (backwards compatible)
- **PATCH**: Bug fixes (backwards compatible)

Run `/update` to ensure you have the latest features and fixes!