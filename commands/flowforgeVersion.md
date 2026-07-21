---
description: Show FlowForge version and changelog information
argument-hint: "(no arguments needed)"
---

# 🔢 FlowForge Version Information

## 📌 Current Version
```bash
# Display current FlowForge version
if [ -f ".flowforge/VERSION" ]; then
    CURRENT_VERSION=$(cat .flowforge/VERSION)
    echo "🔥 FlowForge Version: $CURRENT_VERSION"
else
    echo "⚠️  Version file not found. You may be using FlowForge < 1.1.0"
    echo "💡 Run /update to upgrade to the latest version"
    exit 1
fi

# Show installation date if available
if [ -f ".flowforge/.setup-date" ]; then
    INSTALL_DATE=$(cat .flowforge/.setup-date)
    echo "📅 Installed on: $INSTALL_DATE"
fi

# Check if this is a git submodule
if [ -f ".gitmodules" ] && grep -q ".flowforge" .gitmodules; then
    echo "📦 Installation type: Git Submodule"
    
    # Show commit info
    cd .flowforge
    COMMIT=$(git rev-parse --short HEAD)
    BRANCH=$(git branch --show-current)
    echo "🔗 Commit: $COMMIT on branch $BRANCH"
    cd ..
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
    # Extract the section for current version
    awk "/## \[$CURRENT_VERSION\]/,/^## \[/" .flowforge/CHANGELOG.md | head -n -1
else
    echo "Changelog not found. This version may not have detailed change information."
fi

echo "════════════════════════════════════════════"
```

## 🌐 Check for Updates
```bash
echo -e "\n🔍 Checking for updates..."

# Try to fetch latest version from GitHub
LATEST_VERSION=$(curl -s https://api.github.com/repos/JustCode-CruzAlex/FlowForge/contents/VERSION 2>/dev/null | grep '"content"' | cut -d'"' -f4 | base64 -d | tr -d '\n')

if [ -z "$LATEST_VERSION" ]; then
    echo "⚠️  Could not check for updates (no internet connection?)"
else
    echo "🌟 Latest available: v$LATEST_VERSION"
    
    if [ "$CURRENT_VERSION" = "$LATEST_VERSION" ]; then
        echo "✅ You're on the latest version!"
    else
        echo "🆕 Update available: $CURRENT_VERSION → $LATEST_VERSION"
        echo ""
        echo "📥 To update, run: /update"
        
        # Show what's new in the latest version
        echo -e "\n🎯 What's new in v$LATEST_VERSION:"
        echo "────────────────────────────────────"
        
        # Try to fetch latest changelog
        LATEST_CHANGELOG=$(curl -s https://raw.githubusercontent.com/JustCode-CruzAlex/FlowForge/main/CHANGELOG.md 2>/dev/null)
        if [ -n "$LATEST_CHANGELOG" ]; then
            echo "$LATEST_CHANGELOG" | awk "/## \[$LATEST_VERSION\]/,/^## \[/" | head -20
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
    # Show version list
    grep "^## \[" .flowforge/CHANGELOG.md | head -5 | while read -r line; do
        VERSION=$(echo "$line" | sed -n 's/.*\[\([^]]*\)\].*/\1/p')
        DATE=$(echo "$line" | sed -n 's/.*- \(.*\)/\1/p')
        if [ "$VERSION" = "$CURRENT_VERSION" ]; then
            echo "• v$VERSION - $DATE ← Current"
        else
            echo "• v$VERSION - $DATE"
        fi
    done
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
```

## 💡 Version Information

**Semantic Versioning**: FlowForge follows semantic versioning:
- **MAJOR.MINOR.PATCH** (e.g., 1.2.0)
- **MAJOR**: Incompatible API changes
- **MINOR**: New functionality (backwards compatible)
- **PATCH**: Bug fixes (backwards compatible)

Run `/update` to ensure you have the latest features and fixes!