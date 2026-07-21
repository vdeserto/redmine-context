# FlowForge Claude.md Setup

Install or update the Claude.md context file with FlowForge workflow configuration.

## Description

This command creates or updates a Claude.md file in your project with essential FlowForge context, ensuring Claude Code has all the necessary information about your workflow, rules, and available commands.

## Usage

```bash
/flowforge:setup:claude-md [options]
```

## Options

- `--mode=MODE` - Installation mode: create, append, update, auto (default: auto)
- `--backup` - Create backup before modifying existing file (default: true)
- `--project-name=NAME` - Override project name detection
- `--dry-run` - Show what would be done without making changes
- `--force` - Overwrite existing FlowForge context without prompting

## Execution

```bash
#!/bin/bash
# FlowForge Claude.md Setup Command
# Installs or updates Claude.md with FlowForge context

# Parse arguments
MODE="auto"
BACKUP=true
PROJECT_NAME=""
DRY_RUN=false
FORCE=false

for arg in "$@"; do
    case $arg in
        --mode=*)
            MODE="${arg#*=}"
            ;;
        --no-backup)
            BACKUP=false
            ;;
        --project-name=*)
            PROJECT_NAME="${arg#*=}"
            ;;
        --dry-run)
            DRY_RUN=true
            ;;
        --force)
            FORCE=true
            ;;
        --help)
            echo "Usage: flowforge:setup:claude-md [options]"
            echo ""
            echo "Options:"
            echo "  --mode=MODE          Installation mode (create|append|update|auto)"
            echo "  --no-backup          Skip backup creation"
            echo "  --project-name=NAME  Override project name"
            echo "  --dry-run            Show what would be done"
            echo "  --force              Overwrite without prompting"
            echo "  --help               Show this help"
            exit 0
            ;;
    esac
done

# Get project directory and name
TARGET_DIR="$(pwd)"
if [ -z "$PROJECT_NAME" ]; then
    PROJECT_NAME=$(basename "$TARGET_DIR")
fi

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}🤖 FlowForge Claude.md Setup${NC}"
echo "Target Directory: $TARGET_DIR"
echo "Project Name: $PROJECT_NAME"
echo "Mode: $MODE"
echo ""

# Check if Node.js version is available
if command -v node &>/dev/null && [ -f ".flowforge/lib/claude-md-installer.js" ]; then
    echo -e "${BLUE}Using advanced Claude.md installer...${NC}"

    # Use Node.js installer
    cat > /tmp/claude-md-runner.js << 'EOF'
const { ClaudeMdInstaller } = require('./.flowforge/lib/claude-md-installer.js');
const args = process.argv.slice(2);

const options = {
    mode: 'auto',
    backup: true,
    projectName: '',
    dryRun: false,
    force: false
};

// Parse arguments
for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--mode=')) {
        options.mode = arg.split('=')[1];
    } else if (arg === '--no-backup') {
        options.backup = false;
    } else if (arg.startsWith('--project-name=')) {
        options.projectName = arg.split('=')[1];
    } else if (arg === '--dry-run') {
        options.dryRun = true;
    } else if (arg === '--force') {
        options.force = true;
    }
}

const installer = new ClaudeMdInstaller();
installer.runInstallationFlow('.', {
    interactive: false,
    mode: options.mode,
    defaults: {
        projectName: options.projectName || require('path').basename(process.cwd()),
        backup: options.backup,
        force: options.force
    }
}).then(result => {
    if (result.result.success) {
        console.log(`✅ Claude.md ${result.result.mode} successfully`);
        if (result.result.backupPath) {
            console.log(`📝 Backup created: ${result.result.backupPath}`);
        }
        process.exit(0);
    } else {
        console.error(`❌ Failed: ${result.result.error}`);
        process.exit(1);
    }
}).catch(error => {
    console.error('Error:', error.message);
    process.exit(1);
});
EOF

    # Run the Node.js installer
    if [ "$DRY_RUN" = true ]; then
        echo -e "${YELLOW}[DRY RUN] Would run Node.js Claude.md installer${NC}"
    else
        node /tmp/claude-md-runner.js --mode="$MODE" --project-name="$PROJECT_NAME" $([ "$BACKUP" = false ] && echo "--no-backup") $([ "$FORCE" = true ] && echo "--force")
    fi

    rm -f /tmp/claude-md-runner.js
    exit $?
fi

# Fallback to bash implementation
echo -e "${YELLOW}Using fallback bash implementation...${NC}"

# Detect existing Claude.md
CLAUDE_FILE=""
if [ -f "Claude.md" ]; then
    CLAUDE_FILE="Claude.md"
elif [ -f "CLAUDE.md" ]; then
    CLAUDE_FILE="CLAUDE.md"
fi

# Determine operation mode
OPERATION_MODE="$MODE"
if [ "$MODE" = "auto" ]; then
    if [ -z "$CLAUDE_FILE" ]; then
        OPERATION_MODE="create"
    elif grep -q "FLOWFORGE_CONTEXT_START" "$CLAUDE_FILE" 2>/dev/null; then
        OPERATION_MODE="update"
    else
        OPERATION_MODE="append"
    fi
fi

echo "Operation: $OPERATION_MODE"

if [ "$DRY_RUN" = true ]; then
    echo -e "${YELLOW}[DRY RUN] Would $OPERATION_MODE Claude.md${NC}"

    if [ -n "$CLAUDE_FILE" ] && [ "$BACKUP" = true ]; then
        echo -e "${YELLOW}[DRY RUN] Would create backup of $CLAUDE_FILE${NC}"
    fi

    echo -e "${YELLOW}[DRY RUN] Would add FlowForge context with:${NC}"
    echo "  - Project: $PROJECT_NAME"
    echo "  - All 35 FlowForge rules"
    echo "  - Maestro orchestration guidelines"
    echo "  - Agent usage requirements (Rule #35)"
    echo "  - Common commands reference"

    exit 0
fi

# Create backup if needed
if [ -n "$CLAUDE_FILE" ] && [ "$BACKUP" = true ]; then
    BACKUP_FILE="${CLAUDE_FILE}.backup.$(date +%s)"
    cp "$CLAUDE_FILE" "$BACKUP_FILE"
    echo -e "${GREEN}📝 Backup created: $BACKUP_FILE${NC}"
fi

# Generate timestamp
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# FlowForge context content
read -r -d '' FLOWFORGE_CONTEXT << 'EOF'
<!-- FLOWFORGE_CONTEXT_START -->

# FlowForge Development Context

## 🚨 CRITICAL: MANDATORY WORKFLOW - NO EXCEPTIONS!

### ⏰ BEFORE ANY WORK - THESE ARE NON-NEGOTIABLE:

1. **RUN SESSION START FIRST** - ALWAYS!
   ```bash
   /flowforge:session:start [ticket-id]
   ```
   This command:
   - ✅ Starts time tracking (NO TIMER = NO PAY!)
   - ✅ Creates/checks out feature branch
   - ✅ Verifies ticket exists
   - ✅ Sets up environment

2. **NEVER SKIP THESE RULES:**
   - **Rule #5**: NO work without valid ticket from configured provider
   - **Rule #18**: NEVER work on main/develop
   - **Rule #3**: Write tests BEFORE code (TDD)
   - **Time = Money**: Timer MUST be running

## 🎯 Core Rules (Never Forget!)
1. **Rule #35**: 🚨 ALWAYS use FlowForge agents when available (MANDATORY)
2. **Rule #5**: No work without valid ticket from configured provider
3. **Rule #3**: Write tests BEFORE code (TDD) - 80%+ coverage
4. **Rule #18**: Never work on main/develop directly
5. **Rule #33**: No AI references in output

## 🚨⚡ SUPREME RULE: CLAUDE THE MAESTRO ⚡🚨

```
┌─────────────────────────────────────────────────────────────────┐
│  🎼 YOU ARE THE CONDUCTOR - NOT THE MUSICIAN 🎼                  │
│                                                                 │
│  ⚡ MAESTRO NEVER DOES WORK DIRECTLY                            │
│  ⚡ MAESTRO ALWAYS ORCHESTRATES THROUGH AGENTS                  │
│  ⚡ MAESTRO COORDINATES BUT DOESN'T CODE                        │
│  ⚡ MAESTRO PRESENTS OPTIONS BUT DOESN'T CHOOSE                 │
│                                                                 │
│  🚨 THIS OVERRIDES EVERYTHING ELSE - NO EXCEPTIONS! 🚨          │
└─────────────────────────────────────────────────────────────────┘
```

## 🤖 CRITICAL: FlowForge Agent Usage (Rule #35)
**MANDATORY**: Always use FlowForge agents when available!
- **Documentation**: Use `fft-documentation` agent
- **Testing**: Use `fft-testing` agent
- **Planning**: Use `fft-project-manager` agent
- **Database**: Use `fft-database` agent
- **Architecture**: Use `fft-architecture` agent
- **API Design**: Use `fft-api-designer` agent

## 🔧 Common Commands
```bash
# ALWAYS START HERE - NO EXCEPTIONS!
/flowforge:session:start [ticket]  # MUST RUN FIRST!

# Session Management
/flowforge:session:pause          # Quick pause
/flowforge:session:end [message]  # End work with cleanup

# Development
/flowforge:dev:tdd [feature]      # Test-driven development
/flowforge:dev:checkrules         # Full 35-rule compliance check
/flowforge:dev:status             # Comprehensive status

# FlowForge System
/flowforge:help [category]        # Get help
```

<!-- FLOWFORGE_CONTEXT_END -->
EOF

# Execute the operation
case $OPERATION_MODE in
    "create")
        echo -e "${BLUE}Creating new Claude.md...${NC}"
        cat > Claude.md << EOF
<!-- FLOWFORGE_CONTEXT_START -->

# FlowForge Development Context

**Project**: $PROJECT_NAME
**FlowForge Version**: 2.0.0
**Context Updated**: $TIMESTAMP

$FLOWFORGE_CONTEXT
EOF
        echo -e "${GREEN}✅ Claude.md created successfully${NC}"
        ;;

    "append")
        echo -e "${BLUE}Appending FlowForge context to existing Claude.md...${NC}"
        echo "" >> "$CLAUDE_FILE"
        echo "" >> "$CLAUDE_FILE"
        echo "$FLOWFORGE_CONTEXT" >> "$CLAUDE_FILE"
        echo -e "${GREEN}✅ FlowForge context appended to Claude.md${NC}"
        ;;

    "update")
        echo -e "${BLUE}Updating existing FlowForge context...${NC}"
        # This is a simplified update - just inform the user
        echo -e "${YELLOW}⚠️  Context update requires manual intervention${NC}"
        echo "Existing FlowForge context detected. To update:"
        echo "1. Remove content between <!-- FLOWFORGE_CONTEXT_START --> and <!-- FLOWFORGE_CONTEXT_END -->"
        echo "2. Run this command with --mode=append"
        ;;

    *)
        echo -e "${RED}❌ Unknown operation mode: $OPERATION_MODE${NC}"
        exit 1
        ;;
esac

echo ""
echo -e "${GREEN}🎉 Claude.md setup complete!${NC}"
echo -e "${BLUE}Claude Code now has access to your FlowForge workflow context.${NC}"
```