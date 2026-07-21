# Command: flowforge:project:addrule
# Version: 2.0.0
# Description: FlowForge project addrule command

---
description: Add a new rule to FlowForge and automatically set up enforcement
argument-hint: "[rule-title] [enforcement-type:block|warn] [description]"
---

# 🔒 Add New FlowForge Rule

Adding rule to the FlowForge rule system with automatic enforcement...

## Help Handler
```bash
# Check if help is requested FIRST (before strict mode)
if [[ "${ARGUMENTS:-}" == "?" || "${ARGUMENTS:-}" == "help" ]]; then
    cat << 'HELPEOF'
🔒 Add New FlowForge Rule

Adds a new rule to the FlowForge rule system with automatic enforcement setup.

Usage: /flowforge:project:addrule [rule-title] [enforcement-type] [description]

Arguments:
  rule-title       Title of the new rule (1-3 words)
  enforcement-type Type of enforcement: block or warn
  description      Description of what the rule enforces
  help, ?          Show this help message

Examples:
  /flowforge:project:addrule "Commit Format" block "All commits must follow conventional format"
  /flowforge:project:addrule "Code Style" warn "Use consistent code formatting"

The command will:
• Add the rule to .flowforge/RULES.md
• Create enforcement function skeleton in enforce-all-rules.sh
• Add to pre-commit checks
• Update enforcement configuration
• Create rule documentation

Note: The enforcement logic will need to be implemented manually after rule creation.
HELPEOF
    exit 0
fi
```

## Error Handling Setup
```bash
# Now enable strict error handling
set -euo pipefail

# Error handler function
handle_error() {
    local exit_code=$?
    local line_number=$1
    echo "❌ Error on line $line_number (exit code: $exit_code)"
    
    # Context-specific error messages
    if [[ "${BASH_COMMAND:-}" =~ "RULES.md" ]]; then
        echo "💡 RULES.md file access failed"
        echo "   Check if .flowforge/RULES.md exists and is readable"
        echo "   Ensure you're in a FlowForge project directory"
    elif [[ "${BASH_COMMAND:-}" =~ "enforce-all-rules.sh" ]]; then
        echo "💡 Enforcement script access failed"
        echo "   Check if .flowforge/hooks/enforce-all-rules.sh exists"
        echo "   Ensure the file has proper permissions"
    elif [[ "${BASH_COMMAND:-}" =~ "jq" ]]; then
        echo "💡 JSON processing failed"
        echo "   Check if jq is installed: sudo apt install jq"
        echo "   Verify enforcement.json is valid JSON"
    elif [[ "${BASH_COMMAND:-}" =~ "sed" ]]; then
        echo "💡 File modification failed"
        echo "   Check file permissions and disk space"
        echo "   Ensure the target file is not read-only"
    fi
    
    exit $exit_code
}

# Set error trap
trap 'handle_error $LINENO' ERR

# Enable debug mode if DEBUG=1
[[ "${DEBUG:-0}" == "1" ]] && set -x
```

## Environment Validation
```bash
# Check if we're in a FlowForge project (non-interactive mode for tests)
if [[ "${FLOWFORGE_TEST:-0}" != "1" ]]; then
    if [ ! -f ".flowforge/RULES.md" ]; then
        echo "❌ Error: Not in a FlowForge project directory"
        echo "💡 Navigate to your FlowForge project root directory"
        echo "   The directory should contain .flowforge/RULES.md"
        exit 1
    fi
fi
```

## Parse Arguments
```bash
# Parse the arguments
FULL_ARGS="$ARGUMENTS"
RULE_TITLE=$(echo "$FULL_ARGS" | cut -d' ' -f1-3)
ENFORCEMENT_TYPE=$(echo "$FULL_ARGS" | cut -d' ' -f4)
DESCRIPTION=$(echo "$FULL_ARGS" | cut -d' ' -f5-)

if [ -z "$RULE_TITLE" ] || [ -z "$ENFORCEMENT_TYPE" ]; then
    echo "❌ Usage: /addrule [rule-title] [block|warn] [description]"
    echo "Example: /addrule 'Commit Message Format' block 'All commits must follow conventional format'"
    exit 1
fi

# Validate enforcement type
if [[ "$ENFORCEMENT_TYPE" != "block" && "$ENFORCEMENT_TYPE" != "warn" ]]; then
    echo "❌ Enforcement type must be 'block' or 'warn'"
    echo "💡 Valid enforcement types:"
    echo "   • block - Prevents action when rule is violated"
    echo "   • warn  - Shows warning but allows action to continue"
    exit 1
fi

# Validate description
if [ -z "$DESCRIPTION" ]; then
    echo "❌ Description is required"
    echo "Example: /addrule 'Commit Format' block 'All commits must follow conventional format'"
    exit 1
fi
```

## File System Validation
```bash
# Check if RULES.md exists and is readable
RULES_FILE=".flowforge/RULES.md"
if [ ! -f "$RULES_FILE" ]; then
    echo "❌ Error: RULES.md file not found at $RULES_FILE"
    echo "💡 Ensure you're in a FlowForge project directory"
    echo "   Run 'flowforge init' to initialize a project"
    exit 1
fi

if [ ! -r "$RULES_FILE" ]; then
    echo "❌ Error: Cannot read RULES.md file"
    echo "💡 Check file permissions: chmod 644 $RULES_FILE"
    exit 1
fi

# Check if enforcement script exists
ENFORCE_SCRIPT=".flowforge/hooks/enforce-all-rules.sh"
if [ ! -f "$ENFORCE_SCRIPT" ]; then
    echo "❌ Error: Enforcement script not found at $ENFORCE_SCRIPT"
    echo "💡 Ensure FlowForge hooks are properly installed"
    exit 1
fi

if [ ! -w "$ENFORCE_SCRIPT" ]; then
    echo "❌ Error: Cannot write to enforcement script"
    echo "💡 Check file permissions: chmod 644 $ENFORCE_SCRIPT"
    exit 1
fi

# Check if jq is available for JSON processing
if ! command -v jq >/dev/null 2>&1; then
    echo "❌ Error: jq is required for JSON processing"
    echo "💡 Install jq:"
    echo "   • Ubuntu/Debian: sudo apt install jq"
    echo "   • macOS: brew install jq"
    echo "   • Alpine: apk add jq"
    exit 1
fi
```

## Find Next Rule Number
```bash
# Get the last rule number from RULES.md
LAST_RULE=$(grep -E "^### [0-9]+\." "$RULES_FILE" | tail -1 | sed 's/### \([0-9]\+\).*/\1/' || echo "0")
NEXT_RULE=$((LAST_RULE + 1))

# Check for duplicate rule numbers (shouldn't happen, but safety check)
if grep -q "^### $NEXT_RULE\." "$RULES_FILE"; then
    echo "❌ Error: Rule #$NEXT_RULE already exists"
    echo "💡 This should not happen - there may be a numbering issue in RULES.md"
    exit 1
fi

echo "📋 Adding Rule #$NEXT_RULE: $RULE_TITLE"
```

## Add Rule to RULES.md
```bash
# Check if we can write to RULES.md
if [ ! -w "$RULES_FILE" ]; then
    echo "❌ Error: Cannot write to RULES.md"
    echo "💡 Check file permissions: chmod 644 $RULES_FILE"
    exit 1
fi

# Append the new rule to RULES.md
cat >> "$RULES_FILE" << EOF

### $NEXT_RULE. $RULE_TITLE
- ✅ **$DESCRIPTION**
- 🚫 **Enforcement**: $ENFORCEMENT_TYPE
- 🔧 **Implementation**: Automated via enforce-all-rules.sh
- 📅 **Added**: $(date +%Y-%m-%d)
EOF

echo "✅ Added rule to RULES.md"
```

## Add Enforcement Function
```bash
# Create the enforcement function
ENFORCE_SCRIPT=".flowforge/hooks/enforce-all-rules.sh"
FUNCTION_NAME="check_rule_$NEXT_RULE"

# Find the line before "# Main enforcement function"
LINE_NUM=$(grep -n "# Main enforcement function" "$ENFORCE_SCRIPT" | cut -d: -f1 || echo "")
if [ -z "$LINE_NUM" ]; then
    # Fallback: add at end of file
    LINE_NUM=$(wc -l < "$ENFORCE_SCRIPT")
    INSERT_LINE=$((LINE_NUM))
else
    INSERT_LINE=$((LINE_NUM - 2))
fi

# Create the new function
if [ "$ENFORCEMENT_TYPE" == "block" ]; then
    ACTION="block_action"
else
    ACTION="warn_action"
fi

# Add the function using a more reliable method
{
    head -n $INSERT_LINE "$ENFORCE_SCRIPT"
    cat << EOF

# Rule $NEXT_RULE: $RULE_TITLE
check_rule_$NEXT_RULE() {
    # Implementation for: $DESCRIPTION
    # Example implementation:
    # if [ condition ]; then
    #     $ACTION $NEXT_RULE \\
    #         "Violation detected" \\
    #         "How to fix"
    # fi
    echo "Rule #$NEXT_RULE check not yet implemented - add detection logic"
}
EOF
    tail -n +$((INSERT_LINE + 1)) "$ENFORCE_SCRIPT"
} > "$ENFORCE_SCRIPT.tmp" && mv "$ENFORCE_SCRIPT.tmp" "$ENFORCE_SCRIPT"

echo "✅ Added enforcement function skeleton"
```

## Add to Pre-commit Hook
```bash
# Add the rule check to the pre-commit section
if grep -q "check_rule_33.*# No AI references" "$ENFORCE_SCRIPT"; then
    sed -i "/check_rule_33.*# No AI references/a\\
            check_rule_$NEXT_RULE  # $RULE_TITLE" "$ENFORCE_SCRIPT"
    echo "✅ Added to pre-commit checks"
else
    echo "⚠️  Could not find pre-commit section - manually add check_rule_$NEXT_RULE"
fi
```

## Update Enforcement Config
```bash
# Update the enforcement configuration
CONFIG_FILE=".flowforge/config/enforcement.json"
if [ ! -f "$CONFIG_FILE" ]; then
    mkdir -p "$(dirname "$CONFIG_FILE")"
    echo '{"rules":{}}' > "$CONFIG_FILE"
fi

# Add the new rule to config
jq --arg rule "$NEXT_RULE" \
   --arg title "$RULE_TITLE" \
   --arg type "$ENFORCEMENT_TYPE" \
   --arg desc "$DESCRIPTION" \
   '.rules[$rule] = {title: $title, type: $type, description: $desc, added: now|strftime("%Y-%m-%d")}' \
   "$CONFIG_FILE" > "$CONFIG_FILE.tmp" && mv "$CONFIG_FILE.tmp" "$CONFIG_FILE"

echo "✅ Updated enforcement configuration"
```

## Create Documentation
```bash
# Create a documentation file for the new rule
DOC_FILE="documentation/development/rules/rule-$NEXT_RULE-$(echo "$RULE_TITLE" | tr ' ' '-' | tr '[:upper:]' '[:lower:]').md"
mkdir -p "$(dirname "$DOC_FILE")"

cat > "$DOC_FILE" << EOF
# Rule #$NEXT_RULE: $RULE_TITLE

## Overview
$DESCRIPTION

## Enforcement
- **Type**: $ENFORCEMENT_TYPE
- **Added**: $(date +%Y-%m-%d)
- **Status**: Needs implementation

## Implementation Details
This rule needs implementation in the \`check_rule_$NEXT_RULE()\` function in \`.flowforge/hooks/enforce-all-rules.sh\`.

### Detection Logic
Add specific detection logic for this rule

### Examples
**❌ Violation:**
\`\`\`
// Add example of what violates this rule
\`\`\`

**✅ Correct:**
\`\`\`
// Add example of correct implementation
\`\`\`

## Testing
Add test cases for this rule
EOF

echo "✅ Created rule documentation at $DOC_FILE"
```

## Summary
```bash
echo "
✨ RULE SUCCESSFULLY ADDED! ✨
────────────────────────────────

📋 Rule #$NEXT_RULE: $RULE_TITLE
🔒 Enforcement: $ENFORCEMENT_TYPE
📄 Description: $DESCRIPTION

📁 Files Updated:
- $RULES_FILE
- $ENFORCE_SCRIPT
- $CONFIG_FILE
- $DOC_FILE

⚠️  NEXT STEPS:
1. Edit $ENFORCE_SCRIPT
2. Find the check_rule_$NEXT_RULE() function
3. Implement the detection logic
4. Test the enforcement
5. Update the documentation with examples

💡 The rule is now active but needs implementation!
"
```