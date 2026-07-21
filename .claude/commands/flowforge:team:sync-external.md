# Command: flowforge:team:sync-external
# Version: 2.0.0
# Description: Sync with external time tracking systems
# Issue: #548 - Git-Integrated Namespace System

---
description: Integrate with external time tracking and project management tools
---

# 🔄 External System Integration

## 🔧 Setup
```bash
# Enable strict error handling
set -euo pipefail

# Configuration
FLOWFORGE_ROOT="${FLOWFORGE_ROOT_OVERRIDE:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)/.flowforge}"
SYSTEM="${ARGUMENTS:-}"
```

## 📊 Main Execution
```bash
echo "🔄 External System Sync"
echo "════════════════════════════════════════════════════════════════"

# Check for integration configuration
INTEGRATION_CONFIG="$FLOWFORGE_ROOT/integrations.json"

if [[ ! -f "$INTEGRATION_CONFIG" ]]; then
    echo '{
  "integrations": {
    "jira": {"enabled": false, "url": ""},
    "toggl": {"enabled": false, "api_key": ""},
    "harvest": {"enabled": false, "account_id": ""},
    "clockify": {"enabled": false, "workspace": ""}
  }
}' > "$INTEGRATION_CONFIG"
fi

# Show available integrations
if [[ -z "$SYSTEM" ]]; then
    echo "Available integrations:"
    jq -r '.integrations | to_entries[] | "  • \(.key): \(if .value.enabled then "✅ Enabled" else "❌ Disabled" end)"' "$INTEGRATION_CONFIG"
    echo ""
    echo "Usage: /flowforge:team:sync-external <system>"
    echo "Example: /flowforge:team:sync-external jira"
else
    # Sync with specific system
    echo "Syncing with: $SYSTEM"
    
    # Check if system is configured
    ENABLED=$(jq -r --arg sys "$SYSTEM" '.integrations[$sys].enabled // false' "$INTEGRATION_CONFIG")
    
    if [[ "$ENABLED" == "true" ]]; then
        echo "✅ $SYSTEM integration is configured"
        echo "⚠️  Actual sync implementation pending"
        echo "   This will sync time logs and task status with $SYSTEM"
    else
        echo "❌ $SYSTEM integration not configured"
        echo "💡 Configure in: $INTEGRATION_CONFIG"
    fi
fi

echo "════════════════════════════════════════════════════════════════"
```

## 🎯 Success Output
```bash
echo "✅ External sync status checked"
```