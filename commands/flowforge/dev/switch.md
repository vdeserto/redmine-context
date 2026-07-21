# /flowforge:dev:switch

Switch between developer namespaces seamlessly.

## Description

Switches the active developer namespace, preserving session state and updating environment variables. Enables quick context switching between multiple developers working on the same codebase.

## Usage

```bash
/flowforge:dev:switch <dev_id>
```

## Arguments

- `dev_id` (required): Developer identifier to switch to
  - Must be a configured team member
  - Examples: "dev1", "alex", "sarah"

## Examples

```bash
# Switch to alex's namespace
/flowforge:dev:switch alex

# Switch to dev2's namespace
/flowforge:dev:switch dev2
```

## Implementation

```bash
#!/bin/bash
# FlowForge Developer Namespace Switch
# Seamlessly switch between developer contexts
# Issue #548: Developer Namespace Separation

set -euo pipefail

# Configuration
FLOWFORGE_DIR="${FLOWFORGE_ROOT:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}/.flowforge"
PROJECT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
NAMESPACE_SWITCH="$PROJECT_ROOT/scripts/namespace/switch.sh"
NAMESPACE_MANAGER="$PROJECT_ROOT/scripts/namespace/manager.sh"

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
RED='\033[0;31m'
NC='\033[0m'

# Parse arguments
DEV_ID="${ARGUMENTS:-}"

# Validate arguments
if [[ -z "$DEV_ID" ]]; then
    echo -e "${RED}ERROR: Developer ID required${NC}"
    echo ""
    echo "Usage: /flowforge:dev:switch <dev_id>"
    echo ""
    echo "Examples:"
    echo "  /flowforge:dev:switch alex"
    echo "  /flowforge:dev:switch dev2"
    echo ""

    # Show available developers if namespace switch exists
    if [[ -f "$NAMESPACE_SWITCH" ]]; then
        echo "Available developers:"
        "$NAMESPACE_SWITCH" list 2>/dev/null | grep "^  " || echo "  No developers configured"
    fi

    exit 1
fi

# Header
echo -e "${CYAN}╔══════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║           FlowForge Namespace Switch                ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════════════════╝${NC}"
echo ""

# Check if namespace switch script exists
if [[ ! -f "$NAMESPACE_SWITCH" ]]; then
    echo -e "${RED}ERROR: Namespace switch utility not found${NC}"
    echo "Please ensure FlowForge v2.0+ is properly installed."
    exit 1
fi

# Source namespace manager for current developer info
if [[ -f "$NAMESPACE_MANAGER" ]]; then
    source "$NAMESPACE_MANAGER"
    CURRENT_DEV=$(get_developer_id)
else
    CURRENT_DEV=""
fi

# Show current developer before switch
if [[ -n "$CURRENT_DEV" ]]; then
    echo -e "${BLUE}Current developer: $CURRENT_DEV${NC}"

    # Check for active session
    SESSION_FILE="$FLOWFORGE_DIR/dev-$CURRENT_DEV/sessions/current.json"
    if [[ -f "$SESSION_FILE" ]]; then
        SESSION_ACTIVE=$(jq -r '.active' "$SESSION_FILE" 2>/dev/null || echo "false")
        if [[ "$SESSION_ACTIVE" == "true" ]]; then
            TASK_ID=$(jq -r '.taskId // "unknown"' "$SESSION_FILE" 2>/dev/null || echo "unknown")
            echo -e "${YELLOW}  → Active session for task: $TASK_ID${NC}"
            echo -e "${YELLOW}  → Session will be preserved${NC}"
        fi
    fi
else
    echo -e "${BLUE}No active developer namespace${NC}"
fi

echo ""
echo -e "${BLUE}→ Switching to developer: $DEV_ID${NC}"
echo ""

# Execute switch
if ! "$NAMESPACE_SWITCH" switch "$DEV_ID"; then
    echo -e "${RED}ERROR: Failed to switch namespace${NC}"
    exit 1
fi

# Source the new environment
ENV_FILE="$FLOWFORGE_DIR/.namespace-env"
if [[ -f "$ENV_FILE" ]]; then
    source "$ENV_FILE"

    # Export for current session
    export FLOWFORGE_DEVELOPER
    export FLOWFORGE_NAMESPACE_DIR

    echo ""
    echo -e "${GREEN}╔══════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║           Namespace Switch Successful               ║${NC}"
    echo -e "${GREEN}╚══════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "Active Developer: ${GREEN}$FLOWFORGE_DEVELOPER${NC}"
    echo -e "Namespace Path: $FLOWFORGE_NAMESPACE_DIR"

    # Check for session in new namespace
    NEW_SESSION_FILE="$FLOWFORGE_DIR/dev-$DEV_ID/sessions/current.json"
    if [[ -f "$NEW_SESSION_FILE" ]]; then
        SESSION_ACTIVE=$(jq -r '.active' "$NEW_SESSION_FILE" 2>/dev/null || echo "false")
        if [[ "$SESSION_ACTIVE" == "true" ]]; then
            TASK_ID=$(jq -r '.taskId // "unknown"' "$NEW_SESSION_FILE" 2>/dev/null || echo "unknown")
            echo ""
            echo -e "${GREEN}Resumed active session:${NC}"
            echo "  Task ID: $TASK_ID"
            echo "  Session ID: $(jq -r '.sessionId // "unknown"' "$NEW_SESSION_FILE" 2>/dev/null)"
        fi
    fi

    echo ""
    echo -e "${CYAN}Environment updated for: $FLOWFORGE_DEVELOPER${NC}"
    echo ""
    echo "Next steps:"
    echo "  • Continue working with existing session"
    echo "  • Start new session: /flowforge:session:start [ticket-id]"
    echo "  • Check status: /flowforge:dev:namespace-status"
else
    echo -e "${YELLOW}WARNING: Environment file not created${NC}"
    echo "You may need to manually set FLOWFORGE_DEVELOPER=$DEV_ID"
fi
```

## Features

- **Session Preservation**: Maintains active sessions during switch
- **Environment Updates**: Automatically updates shell environment
- **Validation**: Ensures developer exists before switching
- **Status Display**: Shows before and after state clearly
- **Seamless Transition**: No data loss during switch

## Related Commands

- `/flowforge:dev:namespace-init` - Initialize a new namespace
- `/flowforge:dev:namespace-status` - Check current namespace
- `/flowforge:dev:namespace-clean` - Clean namespace files
- `/flowforge:session:start` - Start a development session

## Notes

- Active sessions are preserved when switching
- Environment variables are updated automatically
- Each developer maintains separate cache and workspace
- Switch is instant with no data migration required