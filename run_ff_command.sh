#!/bin/bash
# FlowForge Command Runner - Compatible with macOS bash 3.2+
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASH_EXEC="bash"
if [ "$(uname -s)" = "Darwin" ]; then
    BASH_MAJOR="${BASH_VERSINFO[0]:-0}"
    if [ "$BASH_MAJOR" -lt 4 ]; then
        for candidate in /opt/homebrew/bin/bash /usr/local/bin/bash; do
            if [ -x "$candidate" ]; then
                candidate_ver=$("$candidate" -c 'echo ${BASH_VERSINFO[0]}' 2>/dev/null)
                if [ "${candidate_ver:-0}" -ge 4 ]; then
                    BASH_EXEC="$candidate"
                    break
                fi
            fi
        done
        if [ "$BASH_EXEC" = "bash" ]; then
            echo "Warning: macOS bash $BASH_MAJOR detected (needs 4.0+)"
            echo "Some commands may fail. Fix: brew install bash"
            echo ""
        fi
    fi
fi
if [ ! -f "$SCRIPT_DIR/.flowforge/VERSION" ] && [ ! -d "$SCRIPT_DIR/commands/flowforge" ]; then
    echo "Error: run_ff_command.sh must be in FlowForge project root"
    exit 1
fi
cd "$SCRIPT_DIR" || exit 1
COMMAND="$1"
shift
export ARGUMENTS="$*"
COMMAND_PATH="commands/${COMMAND//:///}.md"
if [ ! -f "$COMMAND_PATH" ]; then
    echo "Command file not found: $COMMAND_PATH"
    echo "Run: ./run_ff_command.sh flowforge:help"
    exit 1
fi
echo "Running FlowForge command: $COMMAND with arguments: $ARGUMENTS"
INSIDE_BASH=0
TEMP_SCRIPT="/tmp/flowforge_command_$$.sh"
> "$TEMP_SCRIPT"
while IFS= read -r line; do
    if [ "$line" = '```bash' ]; then
        INSIDE_BASH=1
    elif [ "$line" = '```' ] && [ $INSIDE_BASH -eq 1 ]; then
        INSIDE_BASH=0
    elif [ $INSIDE_BASH -eq 1 ]; then
        echo "$line" >> "$TEMP_SCRIPT"
    fi
done < "$COMMAND_PATH"
if [ -s "$TEMP_SCRIPT" ]; then
    "$BASH_EXEC" "$TEMP_SCRIPT"
    EXIT_CODE=$?
    rm -f "$TEMP_SCRIPT"
    exit $EXIT_CODE
else
    echo "Error: No bash code found in command file"
    exit 1
fi
