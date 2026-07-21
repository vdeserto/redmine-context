# /flowforge:dev:namespace-init

Initialize developer namespace for seamless multi-developer workflows.

## Description

Sets up a dedicated namespace for a developer, creating isolated workspace directories and configuration files. This enables multiple developers to work on the same codebase without conflicts.

## Usage

```bash
/flowforge:dev:namespace-init [dev_id] [--auto]
```

## Arguments

- `dev_id` (optional): Developer identifier (e.g., "dev1", "alex", "sarah")
  - If not provided, auto-detects from git config
  - Must match a developer in team configuration

## Options

- `--auto`: Automatically configure without prompts

## Examples

```bash
# Initialize for current developer (auto-detect)
/flowforge:dev:namespace-init

# Initialize for specific developer
/flowforge:dev:namespace-init alex

# Initialize with auto-configuration
/flowforge:dev:namespace-init --auto
```

## Implementation

```bash
#!/bin/bash
# FlowForge Developer Namespace Initialization
# Creates isolated workspace for multi-developer support
# Issue #548: Developer Namespace Separation

set -euo pipefail

# Configuration
FLOWFORGE_DIR="${FLOWFORGE_ROOT:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}/.flowforge"
NAMESPACE_SWITCH="$(git rev-parse --show-toplevel 2>/dev/null || pwd)/scripts/namespace/switch.sh"
NAMESPACE_MANAGER="$(git rev-parse --show-toplevel 2>/dev/null || pwd)/scripts/namespace/manager.sh"
TEAM_CONFIG="$FLOWFORGE_DIR/team/config.json"

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
RED='\033[0;31m'
NC='\033[0m'

# Parse arguments
DEV_ID="${ARGUMENTS:-}"
AUTO_MODE=false

# Check for --auto flag
if [[ "$DEV_ID" == *"--auto"* ]]; then
    AUTO_MODE=true
    DEV_ID="${DEV_ID/--auto/}"
    DEV_ID="${DEV_ID// /}" # Remove spaces
fi

# Header
echo -e "${CYAN}╔══════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║         FlowForge Developer Namespace Init          ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════════════════╝${NC}"
echo ""

# Source namespace manager
if [[ -f "$NAMESPACE_MANAGER" ]]; then
    source "$NAMESPACE_MANAGER"
else
    echo -e "${RED}ERROR: Namespace manager not found${NC}"
    echo "Please ensure FlowForge is properly installed."
    exit 1
fi

# Auto-detect developer if not provided
if [[ -z "$DEV_ID" ]]; then
    echo -e "${BLUE}→ Auto-detecting developer...${NC}"

    # Try to detect from environment or git config
    DEV_ID=$(get_developer_id)

    if [[ -z "$DEV_ID" ]]; then
        # If no developer detected, try to match git email
        GIT_EMAIL=$(git config --global user.email 2>/dev/null || echo "")

        if [[ -n "$GIT_EMAIL" ]] && [[ -f "$TEAM_CONFIG" ]]; then
            # Try to find developer by email
            DEV_ID=$(jq -r --arg email "$GIT_EMAIL" '
                .team.developers | to_entries[] |
                select(.value.email == $email) | .key
            ' "$TEAM_CONFIG" 2>/dev/null | head -n 1)
        fi

        # If still no match, prompt user
        if [[ -z "$DEV_ID" ]] && [[ "$AUTO_MODE" != "true" ]]; then
            echo -e "${YELLOW}Could not auto-detect developer.${NC}"
            echo ""

            # Show available developers
            if [[ -f "$TEAM_CONFIG" ]]; then
                echo "Available developers:"
                jq -r '.team.developers | to_entries[] | "  • \(.key) - \(.value.name) (\(.value.email))"' "$TEAM_CONFIG" 2>/dev/null
                echo ""
            fi

            read -p "Enter your developer ID: " DEV_ID
        fi
    fi
fi

# Validate developer ID
if [[ -z "$DEV_ID" ]]; then
    echo -e "${RED}ERROR: No developer ID provided or detected${NC}"
    echo "Please specify a developer ID or configure git email."
    exit 1
fi

# Check if developer exists in team config
if [[ -f "$TEAM_CONFIG" ]]; then
    DEV_EXISTS=$(jq -r --arg dev "$DEV_ID" '.team.developers | has($dev)' "$TEAM_CONFIG" 2>/dev/null || echo "false")

    if [[ "$DEV_EXISTS" != "true" ]]; then
        echo -e "${YELLOW}WARNING: Developer '$DEV_ID' not found in team configuration${NC}"

        if [[ "$AUTO_MODE" != "true" ]]; then
            read -p "Would you like to add this developer to the team? (y/N): " -n 1 -r
            echo

            if [[ $REPLY =~ ^[Yy]$ ]]; then
                # Prompt for developer details
                read -p "Enter developer name: " DEV_NAME
                read -p "Enter developer email: " DEV_EMAIL
                read -p "Enter developer role (frontend/backend/fullstack): " DEV_ROLE

                # Add developer to team config
                TEMP_CONFIG=$(mktemp)
                jq --arg dev "$DEV_ID" \
                   --arg name "$DEV_NAME" \
                   --arg email "$DEV_EMAIL" \
                   --arg role "$DEV_ROLE" \
                   '.team.developers[$dev] = {
                       "name": $name,
                       "email": $email,
                       "role": $role,
                       "added": now | todate
                   }' "$TEAM_CONFIG" > "$TEMP_CONFIG" && mv "$TEMP_CONFIG" "$TEAM_CONFIG"

                echo -e "${GREEN}✓ Added developer to team configuration${NC}"
            else
                echo -e "${RED}Cannot initialize namespace without team membership${NC}"
                exit 1
            fi
        else
            echo -e "${RED}ERROR: Cannot auto-initialize unknown developer${NC}"
            exit 1
        fi
    fi
fi

# Check if namespace already exists
NAMESPACE_DIR="$FLOWFORGE_DIR/dev-$DEV_ID"
if [[ -d "$NAMESPACE_DIR" ]]; then
    echo -e "${YELLOW}Namespace already exists for developer: $DEV_ID${NC}"

    if [[ "$AUTO_MODE" != "true" ]]; then
        read -p "Reinitialize namespace? This will preserve session data. (y/N): " -n 1 -r
        echo

        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            echo -e "${BLUE}Namespace initialization cancelled${NC}"
            exit 0
        fi
    else
        echo -e "${BLUE}Namespace already initialized, skipping${NC}"
        exit 0
    fi
fi

# Initialize namespace
echo -e "${BLUE}→ Initializing namespace for developer: $DEV_ID${NC}"

initialize_namespace "$DEV_ID"

# Get developer info
if [[ -f "$TEAM_CONFIG" ]]; then
    DEV_INFO=$(jq -r --arg dev "$DEV_ID" '.team.developers[$dev]' "$TEAM_CONFIG" 2>/dev/null)
    DEV_NAME=$(echo "$DEV_INFO" | jq -r '.name // "Unknown"')
    DEV_EMAIL=$(echo "$DEV_INFO" | jq -r '.email // "Unknown"')
    DEV_ROLE=$(echo "$DEV_INFO" | jq -r '.role // "Unknown"')
else
    DEV_NAME="Unknown"
    DEV_EMAIL="Unknown"
    DEV_ROLE="Unknown"
fi

# Success output
echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║            Namespace Initialized Successfully        ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "Developer: ${GREEN}$DEV_ID${NC}"
echo -e "Name: $DEV_NAME"
echo -e "Email: $DEV_EMAIL"
echo -e "Role: $DEV_ROLE"
echo ""
echo "Namespace structure created:"
echo -e "  ${CYAN}$NAMESPACE_DIR/${NC}"
echo "  ├── sessions/       # Session management"
echo "  ├── cache/          # Developer-specific cache"
echo "  ├── workspace/      # Working files"
echo "  ├── logs/           # Developer logs"
echo "  └── config.json     # Namespace configuration"
echo ""

# Set as active namespace if not already set
CURRENT_DEV=$(get_developer_id)
if [[ -z "$CURRENT_DEV" ]] || [[ "$AUTO_MODE" == "true" ]]; then
    echo -e "${BLUE}→ Setting as active namespace...${NC}"

    # Export environment variables
    export FLOWFORGE_DEVELOPER="$DEV_ID"
    export FLOWFORGE_NAMESPACE_DIR="$NAMESPACE_DIR"

    # Write environment file
    cat > "$FLOWFORGE_DIR/.namespace-env" << EOF
# FlowForge Namespace Environment
# Generated: $(date -u +"%Y-%m-%dT%H:%M:%SZ")
export FLOWFORGE_DEVELOPER="$DEV_ID"
export FLOWFORGE_NAMESPACE_DIR="$NAMESPACE_DIR"
EOF

    echo -e "${GREEN}✓ Namespace activated${NC}"
fi

echo ""
echo -e "${CYAN}Next steps:${NC}"
echo "  1. Start a session: /flowforge:session:start [ticket-id]"
echo "  2. Switch namespaces: /flowforge:dev:switch <dev_id>"
echo "  3. Check status: /flowforge:dev:namespace-status"
echo ""
echo -e "${GREEN}Happy coding! 🚀${NC}"
```

## Features

- **Auto-detection**: Automatically detects developer from git config
- **Team Integration**: Validates against team configuration
- **Isolated Workspace**: Creates separate directories for each developer
- **Session Preservation**: Maintains session state across switches
- **Zero-friction**: Seamless initialization with minimal input

## Related Commands

- `/flowforge:dev:switch` - Switch between developer namespaces
- `/flowforge:dev:namespace-status` - Show current namespace status
- `/flowforge:dev:namespace-clean` - Clean namespace temporary files
- `/flowforge:session:start` - Start a development session

## Notes

- Namespace directories are created under `.flowforge/dev-<dev_id>/`
- Each developer has isolated session, cache, and workspace directories
- Configuration is stored in namespace-specific `config.json`
- Team configuration must exist before initializing namespaces