# /flowforge:dev:namespace-clean

Clean temporary files and optimize namespace storage.

## Description

Removes temporary files, old cache entries, and rotates logs in a developer's namespace. Preserves important data like session history and configurations while freeing up disk space.

## Usage

```bash
/flowforge:dev:namespace-clean [dev_id] [--all] [--force]
```

## Arguments

- `dev_id` (optional): Developer ID to clean
  - Defaults to current developer
  - Use "all" to clean all namespaces

## Options

- `--all`: Clean all developer namespaces
- `--force`: Skip confirmation prompts
- `--dry-run`: Show what would be cleaned without deleting

## Examples

```bash
# Clean current developer's namespace
/flowforge:dev:namespace-clean

# Clean specific developer's namespace
/flowforge:dev:namespace-clean alex

# Clean all namespaces
/flowforge:dev:namespace-clean --all

# Preview what would be cleaned
/flowforge:dev:namespace-clean --dry-run
```

## Implementation

```bash
#!/bin/bash
# FlowForge Developer Namespace Cleanup
# Clean temporary files and optimize storage
# Issue #548: Developer Namespace Separation

set -euo pipefail

# Configuration
FLOWFORGE_DIR="${FLOWFORGE_ROOT:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}/.flowforge"
PROJECT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
NAMESPACE_MANAGER="$PROJECT_ROOT/scripts/namespace/manager.sh"
TEAM_CONFIG="$FLOWFORGE_DIR/team/config.json"

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
RED='\033[0;31m'
NC='\033[0m'

# Parse arguments
DEV_ID=""
CLEAN_ALL=false
FORCE=false
DRY_RUN=false

for arg in ${ARGUMENTS:-}; do
    case "$arg" in
        --all)
            CLEAN_ALL=true
            ;;
        --force)
            FORCE=true
            ;;
        --dry-run)
            DRY_RUN=true
            ;;
        --*)
            # Skip other flags
            ;;
        *)
            if [[ -z "$DEV_ID" ]]; then
                DEV_ID="$arg"
            fi
            ;;
    esac
done

# Header
echo -e "${CYAN}╔══════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║         FlowForge Namespace Cleanup                 ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════════════════╝${NC}"
echo ""

# Source namespace manager
if [[ -f "$NAMESPACE_MANAGER" ]]; then
    source "$NAMESPACE_MANAGER"
else
    echo -e "${RED}ERROR: Namespace manager not found${NC}"
    exit 1
fi

# Function to format file size
format_size() {
    local size=$1
    if [[ $size -gt 1048576 ]]; then
        echo "$(( size / 1048576 ))MB"
    elif [[ $size -gt 1024 ]]; then
        echo "$(( size / 1024 ))KB"
    else
        echo "${size}B"
    fi
}

# Function to clean a single namespace
clean_namespace() {
    local dev_id="$1"
    local namespace_dir="$FLOWFORGE_DIR/dev-$dev_id"

    if [[ ! -d "$namespace_dir" ]]; then
        echo -e "${YELLOW}Namespace not found for developer: $dev_id${NC}"
        return
    fi

    echo -e "${BLUE}Cleaning namespace for: $dev_id${NC}"
    echo ""

    local total_freed=0

    # Clean temporary workspace files
    local temp_dir="$namespace_dir/workspace/temp"
    if [[ -d "$temp_dir" ]]; then
        echo "  📁 Temporary Files:"

        # Count and size temp files
        local temp_count=$(find "$temp_dir" -type f 2>/dev/null | wc -l)
        local temp_size=$(du -sb "$temp_dir" 2>/dev/null | cut -f1 || echo 0)

        if [[ $temp_count -gt 0 ]]; then
            echo "    Found: $temp_count files ($(format_size $temp_size))"

            if [[ "$DRY_RUN" == "true" ]]; then
                echo -e "    ${CYAN}Would delete all temporary files${NC}"
            else
                find "$temp_dir" -type f -delete 2>/dev/null || true
                echo -e "    ${GREEN}✓ Deleted $temp_count temporary files${NC}"
                total_freed=$((total_freed + temp_size))
            fi
        else
            echo "    No temporary files found"
        fi
    fi

    # Clean old cache files
    local cache_dir="$namespace_dir/cache"
    if [[ -d "$cache_dir" ]]; then
        echo ""
        echo "  💾 Cache Files:"

        # Find old cache files (>24 hours)
        local old_cache=$(find "$cache_dir" -type f -mtime +1 2>/dev/null)
        local old_count=$(echo "$old_cache" | grep -c "^" || echo 0)

        if [[ $old_count -gt 0 ]]; then
            local old_size=0
            while IFS= read -r file; do
                if [[ -f "$file" ]]; then
                    file_size=$(stat -f%z "$file" 2>/dev/null || stat -c%s "$file" 2>/dev/null || echo 0)
                    old_size=$((old_size + file_size))
                fi
            done <<< "$old_cache"

            echo "    Found: $old_count old cache files ($(format_size $old_size))"

            if [[ "$DRY_RUN" == "true" ]]; then
                echo -e "    ${CYAN}Would delete cache files older than 24 hours${NC}"
            else
                echo "$old_cache" | xargs rm -f 2>/dev/null || true
                echo -e "    ${GREEN}✓ Deleted $old_count old cache files${NC}"
                total_freed=$((total_freed + old_size))
            fi
        else
            echo "    No old cache files found"
        fi

        # Clean .tmp files
        local tmp_files=$(find "$cache_dir" -name "*.tmp" -type f 2>/dev/null)
        local tmp_count=$(echo "$tmp_files" | grep -c "^" || echo 0)

        if [[ $tmp_count -gt 0 ]]; then
            local tmp_size=0
            while IFS= read -r file; do
                if [[ -f "$file" ]]; then
                    file_size=$(stat -f%z "$file" 2>/dev/null || stat -c%s "$file" 2>/dev/null || echo 0)
                    tmp_size=$((tmp_size + file_size))
                fi
            done <<< "$tmp_files"

            echo "    Found: $tmp_count temporary cache files ($(format_size $tmp_size))"

            if [[ "$DRY_RUN" == "true" ]]; then
                echo -e "    ${CYAN}Would delete *.tmp files${NC}"
            else
                echo "$tmp_files" | xargs rm -f 2>/dev/null || true
                echo -e "    ${GREEN}✓ Deleted $tmp_count temporary cache files${NC}"
                total_freed=$((total_freed + tmp_size))
            fi
        fi
    fi

    # Rotate large log files
    local log_dir="$namespace_dir/logs"
    if [[ -d "$log_dir" ]]; then
        echo ""
        echo "  📝 Log Files:"

        local large_logs=$(find "$log_dir" -name "*.log" -size +10M 2>/dev/null)
        local large_count=$(echo "$large_logs" | grep -c "^" || echo 0)

        if [[ $large_count -gt 0 ]]; then
            echo "    Found: $large_count large log files (>10MB)"

            if [[ "$DRY_RUN" == "true" ]]; then
                echo -e "    ${CYAN}Would rotate large log files${NC}"
            else
                while IFS= read -r log_file; do
                    if [[ -f "$log_file" ]]; then
                        local log_size=$(stat -f%z "$log_file" 2>/dev/null || stat -c%s "$log_file" 2>/dev/null || echo 0)
                        local backup_name="${log_file}.$(date +%Y%m%d%H%M%S)"
                        mv "$log_file" "$backup_name"
                        touch "$log_file"
                        gzip "$backup_name" 2>/dev/null || true
                        echo -e "    ${GREEN}✓ Rotated: $(basename "$log_file")${NC}"
                        total_freed=$((total_freed + log_size))
                    fi
                done <<< "$large_logs"
            fi
        else
            echo "    No large log files found"
        fi

        # Clean old rotated logs (>7 days)
        local old_logs=$(find "$log_dir" -name "*.log.*" -mtime +7 2>/dev/null)
        local old_log_count=$(echo "$old_logs" | grep -c "^" || echo 0)

        if [[ $old_log_count -gt 0 ]]; then
            local old_log_size=0
            while IFS= read -r file; do
                if [[ -f "$file" ]]; then
                    file_size=$(stat -f%z "$file" 2>/dev/null || stat -c%s "$file" 2>/dev/null || echo 0)
                    old_log_size=$((old_log_size + file_size))
                fi
            done <<< "$old_logs"

            echo "    Found: $old_log_count old rotated logs ($(format_size $old_log_size))"

            if [[ "$DRY_RUN" == "true" ]]; then
                echo -e "    ${CYAN}Would delete rotated logs older than 7 days${NC}"
            else
                echo "$old_logs" | xargs rm -f 2>/dev/null || true
                echo -e "    ${GREEN}✓ Deleted $old_log_count old rotated logs${NC}"
                total_freed=$((total_freed + old_log_size))
            fi
        fi
    fi

    # Clean stale lock files
    local lock_dir="$namespace_dir/sessions/locks"
    if [[ -d "$lock_dir" ]]; then
        echo ""
        echo "  🔒 Lock Files:"

        local stale_locks=$(find "$lock_dir" -name "*.lock" -mtime +1 2>/dev/null)
        local stale_count=$(echo "$stale_locks" | grep -c "^" || echo 0)

        if [[ $stale_count -gt 0 ]]; then
            echo "    Found: $stale_count stale lock files"

            if [[ "$DRY_RUN" == "true" ]]; then
                echo -e "    ${CYAN}Would delete stale locks${NC}"
            else
                echo "$stale_locks" | xargs rm -f 2>/dev/null || true
                echo -e "    ${GREEN}✓ Deleted $stale_count stale locks${NC}"
            fi
        else
            echo "    No stale locks found"
        fi
    fi

    # Summary
    echo ""
    if [[ "$DRY_RUN" == "true" ]]; then
        echo -e "${CYAN}Dry run completed for: $dev_id${NC}"
        echo "  No files were deleted"
    else
        echo -e "${GREEN}Cleanup completed for: $dev_id${NC}"
        if [[ $total_freed -gt 0 ]]; then
            echo "  Space freed: $(format_size $total_freed)"
        else
            echo "  No space freed"
        fi
    fi
    echo ""
}

# Determine which namespaces to clean
DEVELOPERS_TO_CLEAN=""

if [[ "$CLEAN_ALL" == "true" ]]; then
    # Clean all namespaces
    if [[ -f "$TEAM_CONFIG" ]]; then
        DEVELOPERS_TO_CLEAN=$(jq -r '.team.developers | keys[]' "$TEAM_CONFIG" 2>/dev/null)
    else
        echo -e "${RED}ERROR: Team configuration not found${NC}"
        exit 1
    fi

    if [[ -z "$DEVELOPERS_TO_CLEAN" ]]; then
        echo -e "${YELLOW}No developers configured${NC}"
        exit 0
    fi

    echo -e "${BLUE}Cleaning all developer namespaces${NC}"
elif [[ -n "$DEV_ID" ]]; then
    # Clean specific developer
    DEVELOPERS_TO_CLEAN="$DEV_ID"
else
    # Clean current developer
    DEV_ID=$(get_developer_id)
    if [[ -z "$DEV_ID" ]]; then
        echo -e "${RED}ERROR: No active developer namespace${NC}"
        echo "Use /flowforge:dev:namespace-init to initialize a namespace"
        exit 1
    fi
    DEVELOPERS_TO_CLEAN="$DEV_ID"
fi

# Confirm if not forced and not dry run
if [[ "$FORCE" != "true" ]] && [[ "$DRY_RUN" != "true" ]]; then
    echo -e "${YELLOW}This will clean temporary files for the following developers:${NC}"
    echo "$DEVELOPERS_TO_CLEAN" | while read -r dev; do
        echo "  • $dev"
    done
    echo ""
    echo "The following will be cleaned:"
    echo "  • Temporary workspace files"
    echo "  • Cache files older than 24 hours"
    echo "  • Large log files (will be rotated)"
    echo "  • Stale session locks"
    echo ""
    echo -e "${YELLOW}Important data (sessions, configs) will be preserved${NC}"
    echo ""
    read -p "Continue? (y/N): " -n 1 -r
    echo ""
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo -e "${BLUE}Cleanup cancelled${NC}"
        exit 0
    fi
fi

# Perform cleanup
echo ""
while IFS= read -r dev_id; do
    clean_namespace "$dev_id"
done <<< "$DEVELOPERS_TO_CLEAN"

# Final summary
echo -e "${CYAN}═══════════════════════════════════════════${NC}"
if [[ "$DRY_RUN" == "true" ]]; then
    echo -e "${CYAN}Dry run complete - no files were deleted${NC}"
    echo "Run without --dry-run to perform actual cleanup"
else
    echo -e "${GREEN}Namespace cleanup complete!${NC}"
    echo ""
    echo "Preserved:"
    echo "  ✓ Session history"
    echo "  ✓ Current configurations"
    echo "  ✓ Active workspace files"
    echo ""
    echo "Cleaned:"
    echo "  ✓ Temporary files"
    echo "  ✓ Old cache entries"
    echo "  ✓ Large/old logs"
    echo "  ✓ Stale locks"
fi
echo -e "${CYAN}═══════════════════════════════════════════${NC}"
```

## Features

- **Safe Cleanup**: Preserves important data while removing temporary files
- **Multi-Developer**: Can clean individual or all namespaces
- **Dry Run Mode**: Preview what would be cleaned before deletion
- **Log Rotation**: Automatically rotates large log files
- **Space Recovery**: Shows amount of disk space freed

## What Gets Cleaned

### Removed
- Temporary workspace files
- Cache files older than 24 hours
- Temporary cache files (*.tmp)
- Rotated logs older than 7 days
- Stale session locks (>24 hours old)

### Preserved
- Session history and current sessions
- Namespace configurations
- Recent cache files
- Active workspace files
- Current logs

## Related Commands

- `/flowforge:dev:namespace-init` - Initialize a new namespace
- `/flowforge:dev:switch` - Switch between namespaces
- `/flowforge:dev:namespace-status` - Check namespace status
- `/flowforge:session:start` - Start a development session

## Notes

- Always preserves critical data like sessions and configs
- Large logs are rotated and compressed, not deleted
- Use `--dry-run` to preview cleanup before executing
- Cleanup is per-developer, maintaining isolation