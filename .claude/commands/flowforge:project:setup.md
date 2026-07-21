# Command: flowforge:project:setup
# Version: 2.0.0
# Description: FlowForge project setup command

---
description: One-time project setup wizard - Only appears on first FlowForge installation
argument-hint: "[help]"
---

# 🎉 FlowForge Project Setup Wizard

Welcome! This wizard will help you set up your project with FlowForge best practices.

## 🔧 Setup Error Handling
```bash
# Enable strict error handling
set -euo pipefail

# Error handler function
handle_error() {
    local exit_code=$?
    local line_number=$1
    echo "❌ Error on line $line_number (exit code: $exit_code)"
    
    # Provide helpful error messages based on context
    if [[ "${BASH_COMMAND:-}" =~ "gh repo" ]]; then
        echo "💡 GitHub repository operation failed"
        echo "   Check if 'gh' is installed: https://cli.github.com/"
        echo "   Authenticate with: gh auth login"
    elif [[ "${BASH_COMMAND:-}" =~ "git" ]]; then
        echo "💡 Git operation failed"
        echo "   Ensure git is installed and configured"
    elif [[ "${BASH_COMMAND:-}" =~ "read" ]]; then
        echo "💡 User input interrupted"
        echo "   Please run the setup again"
    fi
    
    # Clean up any partial setup
    echo "🧹 Cleaning up partial setup..."
    rm -f run_command.sh 2>/dev/null || true
    
    exit $exit_code
}

# Set error trap
trap 'handle_error $LINENO' ERR

# Enable debug mode if DEBUG=1
[[ "${DEBUG:-0}" == "1" ]] && set -x
```

## 📚 Show Help
```bash
# Check if help is requested
if [[ "${ARGUMENTS:-}" == "?" || "${ARGUMENTS:-}" == "help" ]]; then
    cat << 'EOF'
🎉 FlowForge Project Setup Wizard

One-time setup wizard for new FlowForge projects.

Usage: /flowforge:project:setup [help]

Arguments:
  help, ?    Show this help message

This wizard will:
  • Generate professional README.md with project-specific content
  • Create GitHub repository with labels and branch protection
  • Initialize version tracking and CHANGELOG.md
  • Set up planning preference (sprint vs milestone-based)
  • Create initial GitHub issues for project setup
  • Configure development branches and workflow
  • Initialize comprehensive project structure

Prerequisites:
  - Git installed
  - GitHub CLI (optional, for automation)
  - Node.js (optional, for advanced features)

Note: This is a one-time setup. After completion,
      use /plan to create new tasks.
EOF
    exit 0
fi
```

## 🔍 Step 1: Check if Setup is Needed
```bash
# Check if project is already set up
if [ -f ".flowforge/.setup-complete" ]; then
    echo "✅ Project already set up!"
    echo "💡 Use these commands instead:"
    echo "   • /plan - Create new tasks"
    echo "   • /StartWorkOnNextProgrammedTask - Resume work"
    echo "   • /startsession - Start specific issue"
    exit 0
fi

echo "🚀 Starting FlowForge Project Setup Wizard..."
echo "This is a one-time setup that will:"
echo "• Generate professional README.md"
echo "• Configure GitHub repository"
echo "• Create development branches"
echo "• Set up issue labels"
echo "• Initialize planning system"
echo ""

# Handle non-interactive mode
if [[ ! -t 0 ]] || [[ "${CI:-false}" == "true" ]]; then
    echo "❌ Error: Setup requires interactive mode"
    echo "💡 Run this command in an interactive terminal"
    exit 1
fi

read -p "Ready to begin? [Y/n] " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]] && [[ -n "$REPLY" ]]; then
    echo "✨ Setup cancelled. Run again when ready!"
    exit 0
fi
```

## 📋 Step 2: Gather Project Information
```bash
# Project basics
echo "📝 Let's gather some information about your project..."
echo ""

# Function to read with validation
read_required() {
    local prompt="$1"
    local var_name="$2"
    local value=""
    
    while [[ -z "$value" ]]; do
        read -p "$prompt" value
        if [[ -z "$value" ]]; then
            echo "   ⚠️  This field is required. Please enter a value."
        fi
    done
    
    eval "$var_name='$value'"
}

# Gather required information
read_required "1. Project Name: " PROJECT_NAME
read_required "2. Brief Description (one line): " PROJECT_DESC

# Technology selection with validation
echo "3. Primary Technology:"
echo "   a) node    - Node.js/JavaScript"
echo "   b) python  - Python"
echo "   c) go      - Go/Golang"
echo "   d) rust    - Rust"
echo "   e) other   - Other technology"
read -p "   Select (a-e): " tech_choice

case "$tech_choice" in
    a) PROJECT_TECH="node" ;;
    b) PROJECT_TECH="python" ;;
    c) PROJECT_TECH="go" ;;
    d) PROJECT_TECH="rust" ;;
    e) read -p "   Specify technology: " PROJECT_TECH ;;
    *) PROJECT_TECH="other" ;;
esac

read_required "4. Your Name/Organization: " PROJECT_OWNER

# License selection
echo "5. License:"
echo "   a) MIT"
echo "   b) Apache-2.0"
echo "   c) GPL-3.0"
echo "   d) BSD-3-Clause"
echo "   e) Other"
read -p "   Select (a-e): " license_choice

case "$license_choice" in
    a) PROJECT_LICENSE="MIT" ;;
    b) PROJECT_LICENSE="Apache-2.0" ;;
    c) PROJECT_LICENSE="GPL-3.0" ;;
    d) PROJECT_LICENSE="BSD-3-Clause" ;;
    e) read -p "   Specify license: " PROJECT_LICENSE ;;
    *) PROJECT_LICENSE="MIT" ;;
esac

# Planning preference selection
echo -e "\n📅 Choose your planning approach..."
echo "6. Planning Method:"
echo "   a) Sprint-based (2-week iterations, agile teams)"
echo "   b) Milestone-based (feature-focused, flexible timeline)"
read -p "   Select (a-b): " planning_choice

case "$planning_choice" in
    a) PLANNING_MODE="sprint" ;;
    b) PLANNING_MODE="milestone" ;;
    *) PLANNING_MODE="milestone" ;; # Default to milestone
esac

# Version tracking preference
echo -e "\n🔢 Version Tracking:"
echo "FlowForge can track your project versions automatically with:"
echo "• Semantic versioning (0.0.1 format)"
echo "• Automatic CHANGELOG.md updates"
echo "• Version badges in README"
read -p "Enable version tracking? [Y/n] " -n 1 -r version_reply
echo
VERSION_TRACKING="false"
if [[ $version_reply =~ ^[Yy]$ ]] || [[ -z $version_reply ]]; then
    VERSION_TRACKING="true"
fi

# Project details for README
echo -e "\n📚 Now some details for documentation..."
read_required "7. What problem does this solve? " PROJECT_PROBLEM
read_required "8. Who is the target audience? " PROJECT_AUDIENCE
read -p "9. Key features (comma-separated): " PROJECT_FEATURES
PROJECT_FEATURES="${PROJECT_FEATURES:-Core functionality}"

# Development setup
echo -e "\n🛠️ Development configuration..."
read -p "10. Default port (if applicable, press Enter to skip): " PROJECT_PORT
read -p "11. Main dependencies (comma-separated, press Enter to skip): " PROJECT_DEPS
```

## 📄 Step 3: Generate README.md
```bash
echo -e "\n📄 Generating README.md..."

# Create .flowforge directory
mkdir -p .flowforge

# Check if README exists and backup
if [ -f "README.md" ]; then
    echo "📋 Backing up existing README.md to README.md.backup"
    cp README.md README.md.backup
fi

# Generate README with version tracking support
cat > README.md << EOF
# $PROJECT_NAME

> $PROJECT_DESC

[![FlowForge](https://img.shields.io/badge/Built%20with-FlowForge-blue)](https://github.com/JustCode-CruzAlex/FlowForge)
[![License](https://img.shields.io/badge/License-$PROJECT_LICENSE-green.svg)](LICENSE)
EOF

# Add version badge if enabled
if [ "$VERSION_TRACKING" = "true" ]; then
    echo "[![Version](https://img.shields.io/badge/version-0.0.1-blue.svg)](./CHANGELOG.md)" >> README.md
fi

cat >> README.md << EOF

## 🎯 Problem Statement

$PROJECT_PROBLEM

## 👥 Target Audience

$PROJECT_AUDIENCE

## ✨ Key Features

$(echo "$PROJECT_FEATURES" | tr ',' '\n' | sed 's/^/- /' | sed 's/^ *- /- /')

## 🚀 Quick Start

### Prerequisites

$(case "$PROJECT_TECH" in
    node) echo "- Node.js >= 14.0.0\n- npm or yarn" ;;
    python) echo "- Python >= 3.8\n- pip" ;;
    go) echo "- Go >= 1.18" ;;
    rust) echo "- Rust >= 1.60\n- Cargo" ;;
    *) echo "- $PROJECT_TECH environment" ;;
esac)

### Installation

\`\`\`bash
# Clone the repository
git clone https://github.com/$PROJECT_OWNER/$PROJECT_NAME.git
cd $PROJECT_NAME

# Install dependencies
$(case "$PROJECT_TECH" in
    node) echo "npm install" ;;
    python) echo "pip install -r requirements.txt" ;;
    go) echo "go mod download" ;;
    rust) echo "cargo build" ;;
    *) echo "# See documentation for setup" ;;
esac)
\`\`\`

### Running the Application

\`\`\`bash
$(case "$PROJECT_TECH" in
    node) echo "npm start${PROJECT_PORT:+\n# Server runs on http://localhost:$PROJECT_PORT}" ;;
    python) echo "python main.py${PROJECT_PORT:+\n# Server runs on http://localhost:$PROJECT_PORT}" ;;
    go) echo "go run main.go${PROJECT_PORT:+\n# Server runs on http://localhost:$PROJECT_PORT}" ;;
    rust) echo "cargo run${PROJECT_PORT:+\n# Server runs on http://localhost:$PROJECT_PORT}" ;;
    *) echo "# See documentation for running instructions" ;;
esac)
\`\`\`

## 🧪 Testing

\`\`\`bash
$(case "$PROJECT_TECH" in
    node) echo "npm test" ;;
    python) echo "pytest" ;;
    go) echo "go test ./..." ;;
    rust) echo "cargo test" ;;
    *) echo "# See documentation for testing" ;;
esac)
\`\`\`

## 📋 Project Structure

\`\`\`
$PROJECT_NAME/
├── src/                 # Source code
├── tests/              # Test files
├── documentation/      # Documentation
├── .flowforge/         # FlowForge configuration
└── README.md          # This file
\`\`\`

## 📖 Documentation

See the [documentation](./documentation) directory for:
- [Architecture Overview](./documentation/architecture/README.md)
- [API Reference](./documentation/api/README.md)
- [Development Guide](./documentation/development/README.md)

## 🤝 Contributing

We follow FlowForge development standards:

1. **No work without a GitHub issue** - Create an issue first
2. **Branch naming**: \`feature/[issue]-[description]\`
3. **Test first** - Write tests before implementation
4. **Document everything** - Keep docs current
5. **No direct commits to main/develop**

See [.flowforge/RULES.md](.flowforge/RULES.md) for all development rules.

Contributions are welcome! Please read our Contributing Guide for details on our code of conduct and the process for submitting pull requests.

## 🚦 Development Workflow

1. Pick an issue from the backlog
2. Run \`/flowforge:session:start [issue]\`
3. Write tests first (TDD)
4. Implement the feature
5. Update documentation
6. Create pull request

## 📊 Project Status

EOF

# Add version info if enabled
if [ "$VERSION_TRACKING" = "true" ]; then
    echo "- **Version**: 0.0.1" >> README.md
fi

cat >> README.md << EOF
- **Status**: Active Development
- **Planning**: $PLANNING_MODE
- **CI/CD**: GitHub Actions
- **Test Coverage**: [Badge here]

## 📄 License

This project is licensed under the $PROJECT_LICENSE License - see the [LICENSE](LICENSE) file for details.

## 👏 Acknowledgments

- Built with [FlowForge](https://github.com/JustCode-CruzAlex/FlowForge)
- Maintained by $PROJECT_OWNER

---

<p align="center">
  <i>Built with ❤️ and FlowForge</i>
</p>
EOF

echo "✅ README.md generated!"
```

## 🐙 Step 4: GitHub Repository Setup
```bash
echo -e "\n🐙 Setting up GitHub repository..."

# Check if repo exists
if [ ! -d ".git" ]; then
    echo "📦 Initializing git repository..."
    git init
    git config user.email "${GIT_USER_EMAIL:-user@example.com}"
    git config user.name "${GIT_USER_NAME:-$PROJECT_OWNER}"
    echo "✅ Initialized git repository"
fi

# Check GitHub CLI
if ! command -v gh &> /dev/null; then
    echo "⚠️  GitHub CLI not found. Please install it for full automation."
    echo "📋 Manual steps needed:"
    echo "1. Create repository on GitHub"
    echo "2. Add remote: git remote add origin [url]"
    echo "3. Push code: git push -u origin main"
    echo ""
    echo "💡 Install GitHub CLI from: https://cli.github.com/"
    SKIP_GITHUB=true
else
    # Check authentication
    if ! gh auth status &> /dev/null; then
        echo "⚠️  GitHub CLI not authenticated"
        echo "💡 Run: gh auth login"
        echo "   Then run setup again for GitHub integration"
        SKIP_GITHUB=true
    else
        SKIP_GITHUB=false
        
        # Get repo info
        if ! gh repo view &> /dev/null; then
            echo "📦 Creating GitHub repository..."
            read -p "Make repository private? [y/N] " -n 1 -r
            echo
            VISIBILITY="--public"
            if [[ $REPLY =~ ^[Yy]$ ]]; then
                VISIBILITY="--private"
            fi
            
            # Create repo with error handling
            if gh repo create "$PROJECT_NAME" $VISIBILITY --description "$PROJECT_DESC" --clone=false; then
                REPO_URL=$(gh repo view --json sshUrl -q .sshUrl)
                git remote add origin "$REPO_URL" 2>/dev/null || git remote set-url origin "$REPO_URL"
                echo "✅ GitHub repository created!"
            else
                echo "⚠️  Failed to create GitHub repository"
                echo "💡 Create it manually on GitHub"
                SKIP_GITHUB=true
            fi
        else
            echo "✅ GitHub repository already exists"
        fi
    fi
fi
```

## 🌿 Step 5: Create Development Branches
```bash
echo -e "\n🌿 Creating FlowForge branch structure..."

# Ensure we're on main
if ! git checkout main 2>/dev/null; then
    git checkout -b main
fi

# Initial commit if needed
if ! git log -1 &>/dev/null; then
    git add README.md .flowforge/ 2>/dev/null || true
    git commit -m "Initial commit with FlowForge setup" || {
        echo "⚠️  No changes to commit yet"
    }
fi

# Create develop branch
if ! git checkout develop 2>/dev/null; then
    git checkout -b develop
    echo "✅ Created develop branch"
else
    echo "✅ Develop branch already exists"
fi

# Return to main
git checkout main

# Push branches if GitHub is configured
if [[ "$SKIP_GITHUB" != "true" ]] && git remote get-url origin &>/dev/null; then
    echo "📤 Pushing branches to GitHub..."
    git push -u origin main 2>/dev/null || echo "⚠️  Main branch already pushed"
    git push -u origin develop 2>/dev/null || echo "⚠️  Develop branch already pushed"
    
    # Set default branch with error handling
    echo "🔒 Configuring repository settings..."
    gh repo edit --default-branch main 2>/dev/null || echo "⚠️  Unable to set default branch"
    
    # Try to set branch protection (requires admin access)
    if gh api repos/:owner/:repo/branches/main/protection \
        --method PUT \
        --field required_status_checks='{"strict":true,"contexts":[]}' \
        --field enforce_admins=false \
        --field required_pull_request_reviews='{"required_approving_review_count":1}' \
        --field restrictions=null \
        2>/dev/null; then
        echo "✅ Branch protection configured"
    else
        echo "ℹ️  Branch protection requires admin access - configure manually if needed"
    fi
fi

echo "✅ Branch structure ready!"
```

## 🏷️ Step 6: Create GitHub Labels
```bash
echo -e "\n🏷️ Creating FlowForge issue labels..."

if [[ "$SKIP_GITHUB" != "true" ]]; then
    # Function to create label with error handling
    create_label() {
        local name="$1"
        local color="$2"
        local description="$3"
        
        if gh label create "$name" --color "$color" --description "$description" 2>/dev/null; then
            echo "  ✅ Created: $name"
        else
            echo "  ℹ️  Label exists: $name"
        fi
    }
    
    # Priority labels
    create_label "priority: critical" "FF0000" "Urgent - requires immediate attention"
    create_label "priority: high" "FF6B6B" "Important - address soon"
    create_label "priority: medium" "FFD93D" "Normal priority"
    create_label "priority: low" "6BCB77" "Nice to have"
    create_label "priority: icebox" "E8F9FD" "Future consideration"
    
    # Status labels
    create_label "status: ready" "0052CC" "Ready to work on"
    create_label "status: in-progress" "FFA500" "Currently being worked on"
    create_label "status: blocked" "D13438" "Blocked by dependency"
    create_label "status: review" "8B5CF6" "Ready for review"
    
    # Type labels
    create_label "type: bug" "EE5A24" "Something isn't working"
    create_label "type: feature" "2ECC71" "New feature or request"
    create_label "type: documentation" "3498DB" "Documentation improvements"
    create_label "type: refactor" "95A5A6" "Code improvement"
    create_label "type: test" "F39C12" "Testing improvements"
    
    echo "✅ Labels configured!"
else
    echo "⚠️  Skipping label creation (GitHub CLI not available)"
    echo "💡 Create labels manually in GitHub settings"
fi
```

## 🔢 Step 7: Version Tracking Setup
```bash
if [ "$VERSION_TRACKING" = "true" ]; then
    echo -e "\n🔢 Setting up version tracking..."
    
    # Create VERSION file
    echo "0.0.1" > VERSION
    echo "✅ Created VERSION file (0.0.1)"
    
    # Initialize CHANGELOG.md
    cat > CHANGELOG.md << 'CHANGELOG_EOF'
# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.0.1] - $(date +%Y-%m-%d)
### Added
- Initial project setup with FlowForge
- Project structure and configuration
- Development workflow automation

[Unreleased]: https://github.com/$PROJECT_OWNER/$PROJECT_NAME/compare/v0.0.1...HEAD
[0.0.1]: https://github.com/$PROJECT_OWNER/$PROJECT_NAME/releases/tag/v0.0.1
CHANGELOG_EOF
    
    echo "✅ Created CHANGELOG.md with initial version"
else
    echo -e "\n🔢 Version tracking skipped (can enable later with /flowforge:version:enable)"
fi
```

## 📁 Step 8: Create Directory Structure
```bash
echo -e "\n📁 Creating FlowForge directory structure..."

# Create standard directories
mkdir -p documentation/{architecture,api,development}
mkdir -p .flowforge/{templates,scripts,hooks}
mkdir -p tests/unit

# Create basic documentation files
if [ ! -f "documentation/README.md" ]; then
    cat > documentation/README.md << 'EOF'
# 📚 Documentation

Welcome to the $PROJECT_NAME documentation!

## 📖 Contents

- Architecture - System design and architecture documentation
- API Reference - API documentation  
- Development - Development guides and procedures

## 🚀 Quick Links

- Getting Started - See project README
- License - See LICENSE file
EOF
fi

# Note: CONTRIBUTING.md creation removed - not required for initial setup

# Create .gitignore if needed
if [ ! -f ".gitignore" ]; then
    echo "📝 Creating .gitignore..."
    case "$PROJECT_TECH" in
        node)
            cat > .gitignore << 'EOF'
node_modules/
dist/
build/
.env
.env.local
npm-debug.log*
yarn-debug.log*
yarn-error.log*
.DS_Store
*.log
coverage/
.nyc_output/
EOF
            ;;
        python)
            cat > .gitignore << 'EOF'
__pycache__/
*.py[cod]
*$py.class
.env
venv/
env/
.pytest_cache/
.coverage
htmlcov/
dist/
build/
*.egg-info/
.DS_Store
EOF
            ;;
        go)
            cat > .gitignore << 'EOF'
*.exe
*.exe~
*.dll
*.so
*.dylib
*.test
*.out
vendor/
.env
.DS_Store
EOF
            ;;
        rust)
            cat > .gitignore << 'EOF'
target/
Cargo.lock
**/*.rs.bk
.env
.DS_Store
EOF
            ;;
        *)
            cat > .gitignore << 'EOF'
.env
.DS_Store
*.log
tmp/
temp/
EOF
            ;;
    esac
fi

echo "✅ Directory structure created!"
```

## 📅 Step 9: Initialize Planning System
```bash
echo -e "\n📅 Setting up planning system..."

# Create planning configuration based on user preference
if [ "$PLANNING_MODE" = "sprint" ]; then
    echo "🏃 Setting up Sprint-based planning..."
    
    # Ask for first sprint goal
    read -p "What's your first sprint goal? " SPRINT_GOAL
    SPRINT_GOAL="${SPRINT_GOAL:-Complete initial setup}"
    
    # Initialize planning in tasks.json via provider-bridge
    echo "✅ Sprint planning initialized"
    SPRINT_END=$(date -d "+14 days" +%Y-%m-%d)
    
    # Ensure tasks.json exists
    mkdir -p .flowforge
    if [ ! -f ".flowforge/tasks.json" ]; then
        echo '{"version":"2.0.0","lastSync":null,"milestones":{},"tasks":[],"timeSessions":{},"metadata":{"totalTasks":0,"completedTasks":0,"totalHours":0,"nextTaskId":1}}' > .flowforge/tasks.json
    fi
    
    # Create first sprint milestone in tasks.json
    node scripts/provider-bridge.js create-task \
        --title="Sprint 1: $SPRINT_GOAL" \
        --description="Sprint Duration: $(date +%Y-%m-%d) to $SPRINT_END | Goal: $SPRINT_GOAL" \
        --status="active" \
        --priority="high" \
        --format=simple > /dev/null 2>&1 || true
    
    
else
    echo "🎯 Setting up Milestone-based planning..."
    
    # Ask for first milestone
    read -p "What's your first milestone? " MILESTONE_NAME
    MILESTONE_NAME="${MILESTONE_NAME:-Initial Setup}"
    read -p "Target completion (days from now): " MILESTONE_DAYS
    MILESTONE_DAYS="${MILESTONE_DAYS:-30}"
    
    # Initialize planning in tasks.json via provider-bridge
    echo "✅ Milestone planning initialized"
    TARGET_DATE=$(date -d "+$MILESTONE_DAYS days" +%Y-%m-%d)
    
    # Ensure tasks.json exists
    mkdir -p .flowforge
    if [ ! -f ".flowforge/tasks.json" ]; then
        echo '{"version":"2.0.0","lastSync":null,"milestones":{},"tasks":[],"timeSessions":{},"metadata":{"totalTasks":0,"completedTasks":0,"totalHours":0,"nextTaskId":1}}' > .flowforge/tasks.json
    fi
    
    # Create first milestone in tasks.json
    node scripts/provider-bridge.js create-task \
        --title="Milestone: $MILESTONE_NAME" \
        --description="Target Date: $TARGET_DATE | Status: Planning | Progress: 0%" \
        --status="active" \
        --priority="high" \
        --format=simple > /dev/null 2>&1 || true
fi
```

## 📋 Step 10: Create Initial GitHub Issues
```bash
echo -e "\n📋 Creating initial GitHub issues..."

# Only create issues if GitHub is available
if [[ "$SKIP_GITHUB" != "true" ]]; then
    # Create setup issues with error handling
    echo "📦 Creating project setup issues..."
    
    ISSUE1=$(gh issue create --title "Complete project setup verification" \
        --body "Verify all FlowForge systems are working correctly:\n- [ ] Time tracking functional\n- [ ] Git hooks active\n- [ ] Commands responding\n- [ ] Documentation accessible\n\nEstimate: 1 hour" \
        --label "type: test,priority: high,status: ready" \
        --assignee @me 2>/dev/null | grep -oE '[0-9]+$' || echo "manual")
    
    ISSUE2=$(gh issue create --title "Create initial test structure" \
        --body "Set up comprehensive testing framework:\n- [ ] Choose test framework for $PROJECT_TECH\n- [ ] Configure test runner\n- [ ] Write first unit test\n- [ ] Set up coverage reporting\n\nEstimate: 2 hours" \
        --label "type: test,priority: high,status: ready" \
        --assignee @me 2>/dev/null | grep -oE '[0-9]+$' || echo "manual")
    
    ISSUE3=$(gh issue create --title "Implement CI/CD pipeline" \
        --body "Set up automated testing and deployment:\n- [ ] Create GitHub Actions workflow\n- [ ] Configure automated testing\n- [ ] Add coverage reporting\n- [ ] Set up deployment pipeline\n\nEstimate: 3 hours" \
        --label "type: chore,priority: medium,status: ready" \
        --assignee @me 2>/dev/null | grep -oE '[0-9]+$' || echo "manual")
    
    if [[ "$ISSUE1" != "manual" ]]; then
        echo "✅ Created initial issues: #$ISSUE1, #$ISSUE2, #$ISSUE3"
        FIRST_ISSUE=$ISSUE1
    else
        echo "⚠️  Issues created manually (GitHub CLI issues)"
        FIRST_ISSUE="1"
    fi
else
    echo "⚠️  Skipping GitHub issues creation (GitHub CLI not available)"
    echo "💡 Create these issues manually:"
    echo "   1. Complete project setup verification"
    echo "   2. Create initial test structure"
    echo "   3. Implement CI/CD pipeline"
    FIRST_ISSUE="1"
fi
```

## 🎯 Step 11: Initialize FlowForge Context
```bash
echo -e "\n🎯 Initializing FlowForge system..."

# Initialize tasks.json if needed
if [ ! -f ".flowforge/tasks.json" ]; then
    mkdir -p .flowforge
    cat > .flowforge/tasks.json << 'EOF'
{
  "version": "2.0.0",
  "lastSync": null,
  "milestones": {},
  "tasks": [],
  "timeSessions": {},
  "metadata": {
    "totalTasks": 0,
    "completedTasks": 0,
    "totalHours": 0,
    "nextTaskId": 1,
    "projectName": "$PROJECT_NAME",
    "projectStart": "$(date +%Y-%m-%d)",
    "methodology": "FlowForge Agile"
  }
}
EOF
fi

# Create CLAUDE.md
if [ ! -f "CLAUDE.md" ]; then
    cat > CLAUDE.md << EOF
# 🤖 Claude Context for $PROJECT_NAME

## 📋 Project Overview
**Name**: $PROJECT_NAME  
**Description**: $PROJECT_DESC  
**Technology**: $PROJECT_TECH  
**Owner**: $PROJECT_OWNER  

## 🎯 Current Focus
- Initial setup complete
- Ready for first planning session

## 🛠️ Key Commands
- \`/plan\` - Create tasks and milestones
- \`/startsession\` - Begin work on a task
- \`/checkrules\` - Verify FlowForge compliance
- \`/endwork\` - End work session

## 📁 Project Structure
- \`/documentation\` - All documentation
- \`/.flowforge\` - FlowForge configuration
- \`/tests\` - Test files

## 🔧 Development Workflow
1. Create tasks with \`/plan\`
2. Start work with \`/startsession [issue]\`
3. Write tests first (TDD)
4. Implement features
5. End session with \`/endwork\`

---
Generated by FlowForge Setup
EOF
fi

# Create initial tasks in tasks.json
if command -v node &>/dev/null && [ -f "scripts/provider-bridge.js" ]; then
    node scripts/provider-bridge.js create-task \
        --title="Run /plan to create first milestone" \
        --status="todo" \
        --priority="high" \
        --format=simple > /dev/null 2>&1 || true

    node scripts/provider-bridge.js create-task \
        --title="Set up CI/CD pipeline" \
        --status="todo" \
        --priority="medium" \
        --format=simple > /dev/null 2>&1 || true

    node scripts/provider-bridge.js create-task \
        --title="Add comprehensive tests" \
        --status="todo" \
        --priority="medium" \
        --format=simple > /dev/null 2>&1 || true

    node scripts/provider-bridge.js create-task \
        --title="Complete documentation" \
        --status="todo" \
        --priority="medium" \
        --format=simple > /dev/null 2>&1 || true
fi

# Mark setup as complete
touch .flowforge/.setup-complete
date +%Y-%m-%d > .flowforge/.setup-date
echo "$PROJECT_NAME" > .flowforge/.project-name

# Create next.json for immediate next steps
if [ ! -f ".flowforge/sessions/next.json" ]; then
    mkdir -p .flowforge/sessions
    cat > .flowforge/sessions/next.json << EOF
{
  "currentWork": {
    "issue": "$FIRST_ISSUE",
    "title": "Complete project setup verification",
    "project": "$PROJECT_NAME",
    "status": "Fresh FlowForge setup complete!",
    "planning": "$PLANNING_MODE",
    "versionTracking": $VERSION_TRACKING
  },
  "setupStatus": {
    "flowforge": true,
    "readme": true,
    "githubRepo": true,
    "branches": true,
    "issueLabels": $(if [[ "$SKIP_GITHUB" != "true" ]]; then echo "true"; else echo "false"; fi),
    "versionTracking": $(if [[ "$VERSION_TRACKING" = "true" ]]; then echo "true"; else echo "false"; fi),
    "planning": "$PLANNING_MODE",
    "initialIssues": true
  },
  "startCommand": "/flowforge:session:start $FIRST_ISSUE"

  "initialTasks": [
    {
      "id": "$FIRST_ISSUE",
      "title": "Complete Project Setup",
      "tasks": [
        "Verify all FlowForge features working",
        "Test time tracking system",
        "Ensure git hooks are active",
        "Validate command responses"
      ]
    },
    {
      "title": "Create Test Structure",
      "tasks": [
        "Set up testing framework for $PROJECT_TECH",
        "Write first unit test",
        "Configure coverage reporting",
        "Add test scripts to package.json"
      ]
    },
    {
      "title": "CI/CD Pipeline",
      "tasks": [
        "Create .github/workflows/ci.yml",
        "Add automated test execution",
        "Configure coverage badge",
        "Set up deployment pipeline"
      ]
    }
  ],
  "projectArchitecture": {
    "technology": "$PROJECT_TECH",
    "structure": "FlowForge standard",
    "planning": "$PLANNING_MODE",
    "versioning": $(if [[ "$VERSION_TRACKING" = "true" ]]; then echo '"Semantic (0.0.1)"'; else echo 'null'; fi),
    "directories": {
      "src": "Source code",
      "tests": "Test files",
      "documentation": "Documentation",
      ".flowforge": "Configuration"
    }
  },
  "firstSteps": [
    "Run /flowforge:session:start $FIRST_ISSUE to begin",
    "Complete the setup verification checklist",
    "Write your first test using TDD",
    "Start building features with test-first approach"
  ],
  "availableCommands": [
    "/flowforge:session:start [issue] - Begin work session",
    "/flowforge:project:plan [feature] - Plan new features",
    "/flowforge:dev:status - Check project status",
    "/flowforge:help - Get help"$(if [[ "$VERSION_TRACKING" = "true" ]]; then echo ',
    "/flowforge:version:check - Check current version"'; fi)
  ],
  "generated": "$(date +"%Y-%m-%dT%H:%M:%SZ")",
  "generatedBy": "FlowForge Project Setup Wizard"
}
EOF
fi

echo "✅ FlowForge initialization complete!"

## ✨ Setup Complete!
```bash
echo ""
echo "════════════════════════════════════════════════════════"
echo "✨ FlowForge Project Setup Complete!"
echo "════════════════════════════════════════════════════════"
echo ""
echo "📋 Project: $PROJECT_NAME"
echo "📁 Location: $(pwd)"
echo "🔧 Technology: $PROJECT_TECH"
echo ""
echo "✅ What was created:"
echo "   • README.md with project information"
echo "   • Directory structure for documentation"
echo "   • Git repository with main/develop branches"
if [[ "$SKIP_GITHUB" != "true" ]]; then
    echo "   • GitHub repository with labels"
    echo "   • Branch protection rules"
fi
echo "   • .flowforge/tasks.json for planning and task tracking"
echo "   • CLAUDE.md for AI context"
echo "   • .flowforge/sessions/ for session tracking"
echo "   • .gitignore for $PROJECT_TECH"
echo ""
echo "🚀 Next Steps:"
echo "   1. Start work: /flowforge:session:start $FIRST_ISSUE"
echo "   2. Plan features: /flowforge:project:plan [description]"
echo "   3. Check status: /flowforge:dev:status"
$(if [[ "$VERSION_TRACKING" = "true" ]]; then echo "   4. Manage versions: /flowforge:version:check"; fi)
echo ""
if [[ "$SKIP_GITHUB" == "true" ]]; then
    echo "⚠️  GitHub setup was skipped. To complete:"
    echo "   1. Install GitHub CLI: https://cli.github.com/"
    echo "   2. Authenticate: gh auth login"
    echo "   3. Create repo manually or run setup again"
    echo ""
fi
echo "📚 For more help: /flowforge:help"
echo ""
echo "📊 Project Summary:"
echo "   • Technology: $PROJECT_TECH"
echo "   • Planning: $PLANNING_MODE"
echo "   • License: $PROJECT_LICENSE"
$(if [[ "$VERSION_TRACKING" = "true" ]]; then echo "   • Versioning: Enabled (0.0.1)"; fi)
echo ""
echo "Happy coding with FlowForge! 🎉"

# Clean up
rm -f run_command.sh 2>/dev/null || true

# Debug info
if [[ "${DEBUG:-0}" == "1" ]]; then
    echo ""
    echo "🔍 Debug Info:"
    echo "  Project: $PROJECT_NAME"
    echo "  Tech: $PROJECT_TECH"
    echo "  License: $PROJECT_LICENSE"
    echo "  Planning: $PLANNING_MODE"
    echo "  Version Tracking: $VERSION_TRACKING"
    echo "  GitHub Skip: ${SKIP_GITHUB:-false}"
    echo "  First Issue: $FIRST_ISSUE"
    echo "  Setup Date: $(date)"
fi
```

**Claude, this is an interactive wizard. Please:**
1. Guide the user through each step
2. Validate all inputs
3. Handle errors gracefully
4. Create a professional project structure
5. Set up GitHub integration if available
6. Initialize FlowForge for immediate use

The wizard should be friendly, helpful, and ensure the project starts with best practices!