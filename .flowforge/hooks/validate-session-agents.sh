#!/bin/bash
# FlowForge Stop Hook - Validate Agent Usage in Session
# Checks if appropriate agents were used for the work done

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Detect shell environment and capabilities
SHELL_TYPE="unknown"
SUPPORTS_ASSOCIATIVE_ARRAYS=false

# Check if we're running in bash
if [ -n "$BASH_VERSION" ]; then
    SHELL_TYPE="bash"
    BASH_VERSION_MAJOR="${BASH_VERSION%%.*}"
    # Check for bash 4+ for associative array support
    if [ "$BASH_VERSION_MAJOR" -ge 4 ] 2>/dev/null; then
        SUPPORTS_ASSOCIATIVE_ARRAYS=true
    fi
# Check if we're running in zsh
elif [ -n "$ZSH_VERSION" ]; then
    SHELL_TYPE="zsh"
    # ZSH doesn't support declare -A in the same way, use fallback
    SUPPORTS_ASSOCIATIVE_ARRAYS=false
else
    # Unknown shell, use fallback
    SHELL_TYPE="unknown"
    SUPPORTS_ASSOCIATIVE_ARRAYS=false
fi

# Debug output (can be commented out in production)
# echo "Shell: $SHELL_TYPE, Version: ${BASH_VERSION:-$ZSH_VERSION:-unknown}, Associative Arrays: $SUPPORTS_ASSOCIATIVE_ARRAYS"

# Check if any files were modified
MODIFIED_FILES=$(git diff --name-only 2>/dev/null || true)

if [ -z "$MODIFIED_FILES" ]; then
    exit 0  # No files modified
fi

# Use appropriate implementation based on shell capabilities
if [ "$SUPPORTS_ASSOCIATIVE_ARRAYS" = "true" ]; then
    # Bash 4+ implementation with associative arrays
    declare -A required_agents
    declare -A agent_files
    
    while IFS= read -r file; do
        case "$file" in
            *.test.*|*.spec.*|*/tests/*)
                # Tests can be written by any coder agent or fft-testing
                # This is now just a suggestion, not a strict requirement
                agent_files["tests"]+="  - $file\n"
                ;;
            *.md|*/documentation/*)
                required_agents["fft-documentation"]=1
                agent_files["fft-documentation"]+="  - $file\n"
                ;;
            *.tsx|*.jsx|*.vue|*/components/*)
                required_agents["fft-frontend"]=1
                agent_files["fft-frontend"]+="  - $file\n"
                ;;
            */api/*|*.graphql|*.proto)
                required_agents["fft-api-designer"]=1
                agent_files["fft-api-designer"]+="  - $file\n"
                ;;
            */migrations/*|*/schema/*|*.sql)
                required_agents["fft-database"]=1
                agent_files["fft-database"]+="  - $file\n"
                ;;
        esac
    done <<< "$MODIFIED_FILES"
    
    # Check agent usage log
    LOG_FILE=".flowforge/logs/agent-usage.log"
    declare -A used_agents
    
    if [ -f "$LOG_FILE" ]; then
        # Get agents used in last hour
        one_hour_ago=$(date -d '1 hour ago' '+%Y-%m-%d %H:%M:%S' 2>/dev/null || date -v-1H '+%Y-%m-%d %H:%M:%S')
        while IFS='|' read -r timestamp agent status; do
            if [[ "$timestamp" > "$one_hour_ago" ]]; then
                used_agents["$agent"]=1
            fi
        done < "$LOG_FILE"
    fi
    
    # Check for violations
    missing_agents=()
    for agent in "${!required_agents[@]}"; do
        if [ -z "${used_agents[$agent]}" ]; then
            missing_agents+=("$agent")
        fi
    done
    
    # Report results
    if [ ${#missing_agents[@]} -gt 0 ]; then
        printf "${YELLOW}════════════════════════════════════════${NC}\n"
        printf "${YELLOW}⚠️  FlowForge Rule #35 Warning${NC}\n"
        printf "${YELLOW}════════════════════════════════════════${NC}\n"
        printf "\n"
        printf "${YELLOW}The following agents should have been used:${NC}\n"
        printf "\n"

        for agent in "${missing_agents[@]}"; do
            printf "${RED}❌ %s${NC}\n" "$agent"
            printf "${BLUE}Files that needed this agent:${NC}\n"
            printf "%b" "${agent_files[$agent]}"
        done

        printf "${BLUE}💡 Next time, use these agents BEFORE modifying files${NC}\n"
        printf "${YELLOW}════════════════════════════════════════${NC}\n"
    else
        if [ ${#required_agents[@]} -gt 0 ]; then
            printf "${GREEN}✅ FlowForge Rule #35: All required agents were used!${NC}\n"
        fi
    fi
else
    # Fallback implementation for shells without associative arrays
    # Use simple lists and string matching instead

    # Build lists of required agents based on file patterns
    required_agents=""
    test_files=""
    doc_files=""
    frontend_files=""
    api_files=""
    db_files=""

    while IFS= read -r file; do
        case "$file" in
            *.test.*|*.spec.*|*/tests/*)
                test_files="${test_files}  - ${file}\\n"
                ;;
            *.md|*/documentation/*)
                if [ -z "$required_agents" ] || ! echo "$required_agents" | grep -q "fft-documentation"; then
                    required_agents="${required_agents}fft-documentation "
                fi
                doc_files="${doc_files}  - ${file}\\n"
                ;;
            *.tsx|*.jsx|*.vue|*/components/*)
                if [ -z "$required_agents" ] || ! echo "$required_agents" | grep -q "fft-frontend"; then
                    required_agents="${required_agents}fft-frontend "
                fi
                frontend_files="${frontend_files}  - ${file}\\n"
                ;;
            */api/*|*.graphql|*.proto)
                if [ -z "$required_agents" ] || ! echo "$required_agents" | grep -q "fft-api-designer"; then
                    required_agents="${required_agents}fft-api-designer "
                fi
                api_files="${api_files}  - ${file}\\n"
                ;;
            */migrations/*|*/schema/*|*.sql)
                if [ -z "$required_agents" ] || ! echo "$required_agents" | grep -q "fft-database"; then
                    required_agents="${required_agents}fft-database "
                fi
                db_files="${db_files}  - ${file}\\n"
                ;;
        esac
    done <<< "$MODIFIED_FILES"

    # Check agent usage log
    LOG_FILE=".flowforge/logs/agent-usage.log"
    used_agents=""

    if [ -f "$LOG_FILE" ]; then
        # Get agents used in last hour (handle both GNU and BSD date)
        if date --version >/dev/null 2>&1; then
            # GNU date
            one_hour_ago=$(date -d '1 hour ago' '+%Y-%m-%d %H:%M:%S')
        else
            # BSD date (macOS)
            one_hour_ago=$(date -v-1H '+%Y-%m-%d %H:%M:%S')
        fi

        while IFS='|' read -r timestamp agent status; do
            # Simple string comparison for timestamp
            if [ "$timestamp" \> "$one_hour_ago" ] 2>/dev/null; then
                used_agents="${used_agents}${agent} "
            fi
        done < "$LOG_FILE"
    fi

    # Check for missing agents
    missing_agents=""
    for agent in $required_agents; do
        if [ -z "$used_agents" ] || ! echo "$used_agents" | grep -q "$agent"; then
            missing_agents="${missing_agents}${agent} "
        fi
    done

    # Report results
    if [ -n "$missing_agents" ]; then
        printf "${YELLOW}════════════════════════════════════════${NC}\n"
        printf "${YELLOW}⚠️  FlowForge Rule #35 Warning${NC}\n"
        printf "${YELLOW}════════════════════════════════════════${NC}\n"
        printf "\n"
        printf "${YELLOW}The following agents should have been used:${NC}\n"
        printf "\n"

        for agent in $missing_agents; do
            # Trim whitespace from agent name
            agent=$(echo "$agent" | tr -d ' ')
            printf "${RED}❌ %s${NC}\n" "$agent"
            printf "${BLUE}Files that needed this agent:${NC}\n"

            # Show relevant files for each agent
            case "$agent" in
                fft-documentation)
                    if [ -n "$doc_files" ]; then
                        printf "%b\n" "$doc_files"
                    fi
                    ;;
                fft-frontend)
                    if [ -n "$frontend_files" ]; then
                        printf "%b\n" "$frontend_files"
                    fi
                    ;;
                fft-api-designer)
                    if [ -n "$api_files" ]; then
                        printf "%b\n" "$api_files"
                    fi
                    ;;
                fft-database)
                    if [ -n "$db_files" ]; then
                        printf "%b\n" "$db_files"
                    fi
                    ;;
            esac
        done

        printf "${BLUE}💡 Next time, use these agents BEFORE modifying files${NC}\n"
        printf "${YELLOW}════════════════════════════════════════${NC}\n"
    else
        if [ -n "$required_agents" ]; then
            printf "${GREEN}✅ FlowForge Rule #35: All required agents were used!${NC}\n"
        fi
    fi
fi

exit 0  # Don't block, just warn