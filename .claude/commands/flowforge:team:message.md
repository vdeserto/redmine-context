# Command: flowforge:team:message
# Version: 2.0.0
# Description: Send message to team
# Issue: #548 - Git-Integrated Namespace System

---
description: Send a message to the team through Git-tracked messaging
---

# 💬 Team Message System

## 🔧 Setup
```bash
# Enable strict error handling
set -euo pipefail

# Configuration
FLOWFORGE_ROOT="${FLOWFORGE_ROOT_OVERRIDE:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)/.flowforge}"
MESSAGE="${ARGUMENTS:-}"
DEVELOPER="${FLOWFORGE_DEVELOPER_ID:-$(whoami)}"

if [[ -z "$MESSAGE" ]]; then
    echo "Usage: /flowforge:team:message <message>"
    exit 1
fi
```

## 📊 Main Execution
```bash
# Create team messages file if it doesn't exist
MESSAGES_FILE="$FLOWFORGE_ROOT/team/messages.json"

if [[ ! -f "$MESSAGES_FILE" ]]; then
    echo '{ "messages": [] }' > "$MESSAGES_FILE"
fi

# Add message
TEMP_FILE=$(mktemp)
jq --arg dev "$DEVELOPER" \
   --arg msg "$MESSAGE" \
   --arg time "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" \
   '.messages += [{
       "from": $dev,
       "message": $msg,
       "timestamp": $time,
       "read_by": []
   }] | .messages = (.messages | .[-10:])' \
   "$MESSAGES_FILE" > "$TEMP_FILE"

mv "$TEMP_FILE" "$MESSAGES_FILE"

echo "✅ Message sent to team"
echo "From: $DEVELOPER"
echo "Message: $MESSAGE"
echo "Time: $(date -u +"%Y-%m-%d %H:%M:%S UTC")"

# Trigger sync if available
if [[ -f "./scripts/namespace/git-sync.sh" ]]; then
    bash ./scripts/namespace/git-sync.sh sync 2>/dev/null || true
fi
```

## 🎯 Success Output
```bash
echo "✅ Team message delivered"
```