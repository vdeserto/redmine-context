# Command: flowforge:version:post-update
# Version: 2.0.0
# Description: FlowForge version post-update command

---
description: Interactive wizard to set up new features after FlowForge update
argument-hint: "(no arguments needed)"
---

# 🎉 FlowForge Post-Update Setup Wizard

This wizard helps you discover and set up new features after updating FlowForge.

## 🔍 Step 1: Detect Current Version & Features
```bash
# Error handling and help system
if [[ "$1" == "?" ]] || [[ "$1" == "help" ]]; then
    echo "🎉 FlowForge Post-Update Setup Wizard"
    echo "===================================="
    echo ""
    echo "Interactive wizard to set up new features after FlowForge update."
    echo ""
    echo "Usage: /flowforge:version:post-update"
    echo ""
    echo "This wizard:"
    echo "• Detects your current and previous FlowForge versions"
    echo "• Shows which features are already set up"
    echo "• Guides you through setting up new features"
    echo "• Creates learning tasks in GitHub (if connected)"
    echo "• Provides a personalized learning path"
    echo ""
    echo "Features it can set up:"
    echo "• Version tracking system"
    echo "• Project setup wizard"
    echo "• GitHub CLI integration"
    echo "• Planning system"
    echo ""
    echo "Options:"
    echo "  help, ?     Show this help message"
    echo ""
    echo "Examples:"
    echo "  /flowforge:version:post-update     # Run the full wizard"
    echo "  /flowforge:version:post-update ?   # Show help"
    echo ""
    echo "Non-interactive mode:"
    echo "  Set FLOWFORGE_TEST=1 to run without user prompts"
    echo ""
    return 0
fi

# Validate FlowForge directory structure
if [[ ! -d ".flowforge" ]]; then
    echo "❌ ERROR: FlowForge directory not found" >&2
    echo "   Expected: .flowforge/ directory in current path" >&2
    echo "   Current path: $(pwd)" >&2
    echo "   Solution: Run this command from your FlowForge project root" >&2
    return 1
fi

# Check if .flowforge is actually a file (corrupted state)
if [[ -f ".flowforge" ]] && [[ ! -d ".flowforge" ]]; then
    echo "❌ ERROR: FlowForge directory is corrupted" >&2
    echo "   Found file instead of directory: .flowforge" >&2
    echo "   Solution: Remove the file and re-run FlowForge setup" >&2
    return 1
fi

# Check directory permissions
if [[ ! -r ".flowforge" ]]; then
    echo "❌ ERROR: Permission denied accessing .flowforge directory" >&2
    echo "   Cannot read: .flowforge/" >&2
    echo "   Solution: Check directory permissions" >&2
    return 1
fi

# Validate VERSION file exists
if [[ ! -f ".flowforge/VERSION" ]]; then
    echo "❌ ERROR: VERSION file not found" >&2
    echo "   Expected: .flowforge/VERSION" >&2
    echo "   Solution: Reinstall FlowForge or run /flowforge:version:check" >&2
    return 1
fi

# Validate VERSION file is readable and not empty
if [[ ! -r ".flowforge/VERSION" ]]; then
    echo "❌ ERROR: Cannot read VERSION file" >&2
    echo "   File: .flowforge/VERSION" >&2
    echo "   Solution: Check file permissions" >&2
    return 1
fi

CURRENT_VERSION=$(cat .flowforge/VERSION 2>/dev/null)
if [[ -z "$CURRENT_VERSION" ]]; then
    echo "❌ ERROR: VERSION file is empty" >&2
    echo "   File: .flowforge/VERSION" >&2
    echo "   Solution: Reinstall FlowForge" >&2
    return 1
fi

# Validate version format (basic semantic versioning)
if [[ ! "$CURRENT_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+([.-][a-zA-Z0-9]+)*$ ]]; then
    echo "❌ ERROR: Invalid version format in VERSION file" >&2
    echo "   Found: '$CURRENT_VERSION'" >&2
    echo "   Expected: semantic version (e.g., 1.3.71)" >&2
    echo "   Solution: Fix VERSION file or reinstall FlowForge" >&2
    return 1
fi

# Safely read previous version with error handling
PREVIOUS_VERSION="1.0.0"  # Default fallback
if [[ -f ".flowforge/.last-version" ]]; then
    if [[ -r ".flowforge/.last-version" ]]; then
        PREVIOUS_VERSION_RAW=$(cat .flowforge/.last-version 2>/dev/null)
        if [[ -n "$PREVIOUS_VERSION_RAW" ]]; then
            # Validate previous version format (allow some flexibility)
            if [[ "$PREVIOUS_VERSION_RAW" =~ ^[0-9]+\.[0-9]+\.[0-9]+([.-][a-zA-Z0-9]+)*$ ]]; then
                PREVIOUS_VERSION="$PREVIOUS_VERSION_RAW"
            else
                echo "⚠️  WARNING: Invalid previous version format, using default" >&2
                echo "   Found: '$PREVIOUS_VERSION_RAW'" >&2
                echo "   Using: v1.0.0 as fallback" >&2
            fi
        fi
    else
        echo "⚠️  WARNING: Cannot read .last-version file, using default" >&2
    fi
fi

# Initialize feature detection with error handling
FEATURES_STATUS=()
VERSION_ENABLED=false
SETUP_COMPLETE=false
GH_CONNECTED=false

echo "🔄 FlowForge Update Detected!"
echo "   Previous: v$PREVIOUS_VERSION"
echo "   Current:  v$CURRENT_VERSION"
echo ""

# Detect which features are already set up with error handling
echo "🔍 Analyzing current feature status..."

# Check version tracking with error handling
if [[ -f "VERSION" ]]; then
    if [[ -r "VERSION" ]]; then
        PROJECT_VERSION=$(cat VERSION 2>/dev/null)
        if [[ -n "$PROJECT_VERSION" ]]; then
            FEATURES_STATUS+=("✅ Version Tracking: Enabled (v$PROJECT_VERSION)")
            VERSION_ENABLED=true
        else
            FEATURES_STATUS+=("⚠️  Version Tracking: VERSION file is empty")
            VERSION_ENABLED=false
        fi
    else
        FEATURES_STATUS+=("⚠️  Version Tracking: VERSION file not readable")
        VERSION_ENABLED=false
    fi
else
    FEATURES_STATUS+=("❌ Version Tracking: Not enabled")
    VERSION_ENABLED=false
fi

# Check if setupproject was run with error handling
if [[ -f ".flowforge/.setup-complete" ]]; then
    if [[ -r ".flowforge/.setup-complete" ]]; then
        FEATURES_STATUS+=("✅ Project Setup: Complete")
        SETUP_COMPLETE=true
    else
        FEATURES_STATUS+=("⚠️  Project Setup: Status file not readable")
        SETUP_COMPLETE=false
    fi
else
    FEATURES_STATUS+=("❌ Project Setup: Not run")
    SETUP_COMPLETE=false
fi

# Check planning system with error handling
if [[ -f ".flowforge/tasks.json" ]]; then
    if [[ -r ".flowforge/tasks.json" ]]; then
        FEATURES_STATUS+=("✅ Planning System: Active")
    else
        FEATURES_STATUS+=("⚠️  Planning System: tasks.json not readable")
    fi
else
    FEATURES_STATUS+=("❌ Planning System: Not initialized")
fi

# Check GitHub integration with comprehensive error handling
if command -v gh &> /dev/null; then
    # GitHub CLI is installed, check authentication
    if gh auth status &> /dev/null 2>&1; then
        FEATURES_STATUS+=("✅ GitHub CLI: Connected")
        GH_CONNECTED=true
    else
        FEATURES_STATUS+=("⚠️  GitHub CLI: Not authenticated")
        GH_CONNECTED=false
    fi
else
    FEATURES_STATUS+=("❌ GitHub CLI: Not installed")
    GH_CONNECTED=false
fi
```

## 📋 Step 2: Show Feature Status
```bash
echo "📊 Current Feature Status:"
echo "────────────────────────────────"

# Safely display feature status
if [[ ${#FEATURES_STATUS[@]} -eq 0 ]]; then
    echo "⚠️  WARNING: No feature status detected"
else
    for status in "${FEATURES_STATUS[@]}"; do
        echo "$status"
    done
fi
echo ""

# Count missing features safely
MISSING_FEATURES=0
[[ "$VERSION_ENABLED" == false ]] && ((MISSING_FEATURES++))
[[ "$SETUP_COMPLETE" == false ]] && ((MISSING_FEATURES++))
[[ "$GH_CONNECTED" == false ]] && ((MISSING_FEATURES++))

if [[ $MISSING_FEATURES -eq 0 ]]; then
    echo "🎯 All features are set up! Here's what's new in v$CURRENT_VERSION:"
else
    echo "🔧 Let's set up $MISSING_FEATURES missing feature(s):"
fi
echo ""
```

## 🎯 Step 3: Interactive Feature Setup
```bash
# Function to create learning tasks with comprehensive error handling
create_learning_task() {
    local title="$1"
    local body="$2"
    
    # Validate inputs
    if [[ -z "$title" ]]; then
        echo "⚠️  WARNING: Cannot create learning task - no title provided" >&2
        return 1
    fi
    
    if [[ -z "$body" ]]; then
        echo "⚠️  WARNING: Cannot create learning task - no body provided" >&2
        return 1
    fi
    
    if [[ "$GH_CONNECTED" == true ]]; then
        echo "📝 Creating learning task..."
        
        # Check if we're in a git repository
        if ! git rev-parse --git-dir &> /dev/null; then
            echo "   ⚠️  WARNING: Not in a git repository, cannot create GitHub issue" >&2
            return 1
        fi
        
        # Attempt to create the issue with error handling
        if gh issue create \
            --title "Learn: $title" \
            --body "$body" \
            --label "type: learning,priority: low" \
            --assignee @me 2>/dev/null; then
            echo "   ✅ Learning task created successfully"
        else
            local exit_code=$?
            echo "   ⚠️  WARNING: Could not create GitHub issue (exit code: $exit_code)" >&2
            echo "   Possible causes:" >&2
            echo "   • No repository permissions" >&2
            echo "   • Network connectivity issues" >&2
            echo "   • GitHub CLI authentication expired" >&2
            return $exit_code
        fi
    else
        echo "   ℹ️  GitHub CLI not connected - skipping task creation"
    fi
}

# Version Tracking Setup with error handling
if [[ "$VERSION_ENABLED" == false ]]; then
    echo "🔢 VERSION TRACKING (New in v1.2.0)"
    echo "────────────────────────────────"
    echo "Track your project versions with semantic versioning!"
    echo ""
    echo "Benefits:"
    echo "• Automatic CHANGELOG.md updates"
    echo "• Version badges in README"
    echo "• Release automation"
    echo "• Links versions to sprints/milestones"
    echo ""
    
    # Handle non-interactive mode
    if [[ "${FLOWFORGE_TEST:-}" == "true" ]]; then
        echo "ℹ️  Running in non-interactive mode - skipping version tracking setup"
        echo "   Enable manually with: /enableVersioning"
    else
        # Interactive prompt with timeout safety
        echo "Enable version tracking now? [Y/n] (30s timeout)"
        if read -t 30 -p "Your choice: " -n 1 -r; then
            echo
            if [[ $REPLY =~ ^[Yy]$ ]] || [[ -z $REPLY ]]; then
                echo "🚀 Running: /enableVersioning"
                echo "   Note: This would be executed by Claude in interactive mode"
                
                # Create learning task with error handling
                create_learning_task "Version Management in FlowForge" \
"Learn how to use FlowForge's version management system:

1. Basic Commands:
   - /version - Show current version
   - /versionBump patch - Bug fixes (0.0.X)
   - /versionBump minor - New features (0.X.0)
   - /versionBump major - Breaking changes (X.0.0)

2. Best Practices:
   - Bump version after completing sprints/milestones
   - Always update CHANGELOG.md
   - Tag releases in git

3. Integration:
   - Versions link to your planning system
   - Automatic badge updates in README
   - Git hooks ensure consistency

Resources:
- Run: /version to see current status
- Read: .flowforge/docs/HOWTOINSTALL.md#version-tracking
- Example: Look at FlowForge's own CHANGELOG.md"
            else
                echo "ℹ️  Skipped. You can enable later with: /enableVersioning"
            fi
        else
            echo
            echo "⚠️  Prompt timed out after 30 seconds - skipping version tracking setup"
            echo "   Enable manually with: /enableVersioning"
        fi
    fi
    echo ""
fi

# Project Setup with error handling
if [[ "$SETUP_COMPLETE" == false ]]; then
    echo "🏗️ PROJECT SETUP WIZARD"
    echo "────────────────────────────────"
    echo "One-time setup for professional project structure!"
    echo ""
    echo "What it does:"
    echo "• Generates professional README.md"
    echo "• Creates GitHub branches & protection"
    echo "• Sets up issue labels"
    echo "• Initializes planning system"
    echo "• Creates initial tasks"
    echo ""
    
    # Handle non-interactive mode
    if [[ "${FLOWFORGE_TEST:-}" == "true" ]]; then
        echo "ℹ️  Running in non-interactive mode - skipping project setup"
        echo "   Run manually with: /setupproject"
    else
        # Interactive prompt with timeout safety
        echo "Run project setup wizard? [Y/n] (30s timeout)"
        if read -t 30 -p "Your choice: " -n 1 -r; then
            echo
            if [[ $REPLY =~ ^[Yy]$ ]] || [[ -z $REPLY ]]; then
                echo "🚀 Running: /setupproject"
                echo "   Note: This would be executed by Claude in interactive mode"
            else
                echo "ℹ️  Skipped. Run later with: /setupproject"
            fi
        else
            echo
            echo "⚠️  Prompt timed out after 30 seconds - skipping project setup"
            echo "   Run manually with: /setupproject"
        fi
    fi
    echo ""
fi

# GitHub CLI Setup with error handling
if [[ "$GH_CONNECTED" == false ]]; then
    echo "🐙 GITHUB CLI SETUP"
    echo "────────────────────────────────"
    echo "GitHub CLI enables full FlowForge automation!"
    echo ""
    echo "Quick setup:"
    echo "1. Install: brew install gh (Mac) or see github.com/cli/cli"
    echo "2. Authenticate: gh auth login"
    echo "3. Choose: GitHub.com → SSH → Login with browser"
    echo ""
    echo "Without GitHub CLI, you'll need to:"
    echo "• Create issues manually"
    echo "• Update labels manually"
    echo "• Cannot use /plan automation"
    echo ""
    
    # Handle non-interactive mode
    if [[ "${FLOWFORGE_TEST:-}" == "true" ]]; then
        echo "ℹ️  Running in non-interactive mode - skipping GitHub CLI setup"
        echo "   Setup manually: https://cli.github.com/manual/installation"
    else
        # Interactive prompt with timeout safety
        echo "Open GitHub CLI installation guide? [Y/n] (30s timeout)"
        if read -t 30 -p "Your choice: " -n 1 -r; then
            echo
            if [[ $REPLY =~ ^[Yy]$ ]] || [[ -z $REPLY ]]; then
                echo "📖 Opening: https://cli.github.com/manual/installation"
                echo "   Note: In interactive mode, this would open your browser"
                # Check if we can attempt to open browser
                if command -v open &> /dev/null; then
                    echo "   Attempting to open browser..."
                    open "https://cli.github.com/manual/installation" 2>/dev/null || \
                        echo "   Could not open browser automatically"
                elif command -v xdg-open &> /dev/null; then
                    echo "   Attempting to open browser..."
                    xdg-open "https://cli.github.com/manual/installation" 2>/dev/null || \
                        echo "   Could not open browser automatically"
                else
                    echo "   Manual URL: https://cli.github.com/manual/installation"
                fi
            fi
        else
            echo
            echo "⚠️  Prompt timed out after 30 seconds - skipping GitHub CLI setup"
            echo "   Setup manually: https://cli.github.com/manual/installation"
        fi
    fi
    echo ""
fi
```

## ✨ Step 4: Show What's New
```bash
echo "✨ WHAT'S NEW IN v$CURRENT_VERSION"
echo "────────────────────────────────"

# Version-specific features with error handling
case "$CURRENT_VERSION" in
    "1.2.0")
        echo "🔢 Version Management System"
        echo "   • /enableVersioning - Start tracking versions"
        echo "   • /version - Show current version"
        echo "   • /versionBump - Increment version"
        echo ""
        echo "📋 Enhanced Commands"
        echo "   • /flowforgeVersion - See FlowForge version"
        echo "   • /update - Update FlowForge"
        echo "   • /pause - Quick task switching"
        echo "   • /endday - Full end-of-day automation"
        echo ""
        echo "🏗️ Project Setup"
        echo "   • /setupproject - One-time setup wizard"
        echo "   • /StartWorkOnNextProgrammedTask - Smart starts"
        echo ""
        ;;
    *)
        echo "Check CHANGELOG.md for full details"
        ;;
esac

# Show changelog excerpt with error handling
if [[ -f ".flowforge/CHANGELOG.md" ]]; then
    if [[ -r ".flowforge/CHANGELOG.md" ]]; then
        echo "📋 Recent Changes:"
        echo "────────────────────────────────"
        # Use awk with error handling
        if awk "/## \\[$CURRENT_VERSION\\]/,/^## \\[/" .flowforge/CHANGELOG.md 2>/dev/null | head -20; then
            : # Success, do nothing
        else
            echo "⚠️  Could not parse CHANGELOG.md for version $CURRENT_VERSION"
            echo "   Check CHANGELOG.md format or view manually"
        fi
    else
        echo "⚠️  CHANGELOG.md exists but is not readable"
    fi
else
    echo "ℹ️  No CHANGELOG.md found - changes not documented"
fi
```

## 🎓 Step 5: Create Learning Path
```bash
echo -e "\n🎓 RECOMMENDED LEARNING PATH"
echo "────────────────────────────────"

# Generate personalized learning path with error handling
LEARNING_STEPS=()
step_counter=1

# Build learning steps based on current state
if [[ "$SETUP_COMPLETE" == false ]]; then
    LEARNING_STEPS+=("$step_counter. Run /setupproject to initialize your project")
    ((step_counter++))
fi

if [[ "$GH_CONNECTED" == false ]]; then
    LEARNING_STEPS+=("$step_counter. Set up GitHub CLI for full automation")
    ((step_counter++))
fi

if [[ "$VERSION_ENABLED" == false ]]; then
    LEARNING_STEPS+=("$step_counter. Enable version tracking with /enableVersioning")
    ((step_counter++))
fi

LEARNING_STEPS+=("$step_counter. Try /plan to create your first sprint/milestone")
((step_counter++))
LEARNING_STEPS+=("$step_counter. Use /StartWorkOnNextProgrammedTask to begin work")
((step_counter++))
LEARNING_STEPS+=("$step_counter. End your day with /endday for full automation")

# Display learning steps safely
if [[ ${#LEARNING_STEPS[@]} -eq 0 ]]; then
    echo "⚠️  No learning steps generated"
else
    for step in "${LEARNING_STEPS[@]}"; do
        echo "→ $step"
    done
fi

# Create comprehensive learning issue with error handling
if [[ "$GH_CONNECTED" == true ]]; then
    echo -e "\n📝 Creating comprehensive onboarding checklist..."
    
    # Validate we can create issues before building the body
    if ! command -v gh &> /dev/null; then
        echo "   ⚠️  WARNING: GitHub CLI not found, cannot create onboarding issue" >&2
    elif ! git rev-parse --git-dir &> /dev/null; then
        echo "   ⚠️  WARNING: Not in a git repository, cannot create GitHub issue" >&2
    else
        ONBOARDING_BODY="Welcome to FlowForge v$CURRENT_VERSION! Complete this checklist to master all features:

## 🚀 Initial Setup
- [ ] Run \`/setupproject\` if not already done
- [ ] Verify GitHub CLI is working: \`gh auth status\`
- [ ] Check FlowForge version: \`/flowforgeVersion\`

## 📋 Planning & Tasks
- [ ] Create your first plan: \`/plan \"your feature\"\`
- [ ] Start work: \`/StartWorkOnNextProgrammedTask\`
- [ ] Try quick pause: \`/pause\`
- [ ] End day properly: \`/endday\`

## 🔢 Version Management
- [ ] Enable versioning: \`/enableVersioning\`
- [ ] Check version: \`/version\`
- [ ] Make changes and bump: \`/versionBump patch\`
- [ ] Review CHANGELOG.md

## 📚 Documentation
- [ ] Read: \`.flowforge/docs/HOWTOINSTALL.md\`
- [ ] Review: \`.flowforge/RULES.md\`
- [ ] Check: \`.flowforge/documentation/COMMANDS.md\`

## 🎯 Best Practices
- [ ] Always work with GitHub issues
- [ ] Use semantic commit messages
- [ ] Write tests first (TDD)
- [ ] Update docs as you code
- [ ] No AI mentions in outputs (Rule #33)

Mark items complete as you learn each feature!"

        # Create the comprehensive onboarding task
        create_learning_task "FlowForge v$CURRENT_VERSION Onboarding Checklist" "$ONBOARDING_BODY"
    fi
else
    echo "ℹ️  GitHub CLI not connected - skipping onboarding checklist creation"
    echo "   Connect GitHub CLI to automatically create learning tasks"
fi
```

## ✅ Step 6: Save Progress & Next Steps
```bash
# Save current version for next update with error handling
echo "💾 Saving version state..."
if echo "$CURRENT_VERSION" > .flowforge/.last-version 2>/dev/null; then
    echo "   ✅ Version state saved successfully"
else
    echo "   ❌ ERROR: Cannot save version state" >&2
    echo "   File: .flowforge/.last-version" >&2
    echo "   This may cause issues with future updates" >&2
    echo "   Solution: Check write permissions for .flowforge/ directory" >&2
fi

echo -e "\n✅ POST-UPDATE WIZARD COMPLETE!"
echo "────────────────────────────────"
echo ""
echo "🎯 Next Steps:"
echo "1. Complete any setup steps above"
echo "2. Check GitHub for learning tasks"
echo "3. Start working with FlowForge!"
echo ""
echo "📚 Resources:"
# Check if resource files exist before listing them
if [[ -f ".flowforge/README.md" ]]; then
    echo "• Documentation: .flowforge/README.md"
else
    echo "• Documentation: .flowforge/README.md (not found)"
fi

if [[ -f ".flowforge/documentation/COMMANDS.md" ]]; then
    echo "• Commands: .flowforge/documentation/COMMANDS.md"
else
    echo "• Commands: .flowforge/documentation/COMMANDS.md (not found)"
fi

if [[ -f ".flowforge/documentation/USER_MANUAL.md" ]]; then
    echo "• Troubleshooting: .flowforge/documentation/USER_MANUAL.md"
else
    echo "• Troubleshooting: .flowforge/documentation/USER_MANUAL.md (not found)"
fi
echo ""
echo "💡 Tip: This wizard runs automatically after updates."
echo "   Run manually anytime with: /flowforge:version:post-update"
echo ""
echo "🔍 Status Summary:"
echo "   FlowForge Version: $CURRENT_VERSION"
echo "   Previous Version: $PREVIOUS_VERSION"
echo "   Features Missing: $MISSING_FEATURES"
echo "   GitHub Connected: $([[ "$GH_CONNECTED" == true ]] && echo "Yes" || echo "No")"
echo ""
```

## 🤖 Claude's Role

When this wizard runs, Claude should:
1. **Execute the setup commands** that the user approves (like /enableVersioning)
2. **Provide context-aware guidance** based on what's already set up
3. **Create meaningful learning tasks** in GitHub if connected
4. **Explain benefits clearly** without overwhelming the user

The wizard is designed to be:
- **Non-intrusive**: Users can skip any step
- **Educational**: Explains why each feature matters
- **Progressive**: Only shows relevant options
- **Actionable**: Direct commands to run
- **Error-resilient**: Handles failures gracefully
- **Non-interactive ready**: Works with FLOWFORGE_TEST=1