#!/bin/bash
# FlowForge Feature Flag Checker
# Usage: check-feature-flag.sh <feature_name>

set -e

# Get the feature name
FEATURE_NAME="${1:-}"

if [ -z "$FEATURE_NAME" ]; then
    echo "Error: Feature name required"
    echo "Usage: $0 <feature_name>"
    exit 1
fi

# Find FlowForge config
CONFIG_FILE=""
if [ -f ".flowforge/config.json" ]; then
    CONFIG_FILE=".flowforge/config.json"
elif [ -f "$HOME/.flowforge/config.json" ]; then
    CONFIG_FILE="$HOME/.flowforge/config.json"
else
    # Feature flags default to enabled if no config found
    echo "enabled"
    exit 0
fi

# Check if feature exists and is enabled
FEATURE_STATUS=$(jq -r ".features.${FEATURE_NAME}.enabled // true" "$CONFIG_FILE" 2>/dev/null || echo "true")

# Convert to boolean check - handle both string and boolean values
if [ "$FEATURE_STATUS" = "true" ] || [ "$FEATURE_STATUS" = "1" ]; then
    echo "enabled"
    
    # Check if experimental
    IS_EXPERIMENTAL=$(jq -r ".features.${FEATURE_NAME}.experimental // false" "$CONFIG_FILE" 2>/dev/null || echo "false")
    if [ "$IS_EXPERIMENTAL" = "true" ] || [ "$IS_EXPERIMENTAL" = "1" ]; then
        echo "experimental" >&2
    fi
    
    exit 0
elif [ "$FEATURE_STATUS" = "false" ] || [ "$FEATURE_STATUS" = "0" ]; then
    echo "disabled"
    exit 1
else
    # Default to enabled for any other value
    echo "enabled"
    exit 0
fi