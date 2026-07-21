# Command: flowforge:project:archive
# Version: 2.0.0
# Description: FlowForge project archive command

---
description: Creates a compressed archive of the current project for backup or distribution
argument-hint: "[name] [help]"
---

# 📦 FlowForge Project Archive

Creates a compressed archive of the current project, excluding common build artifacts and temporary files.

## 🔧 Archive Error Handling
```bash
# Check if help is requested FIRST (before strict mode)
if [[ "${ARGUMENTS:-}" == "?" || "${ARGUMENTS:-}" == "help" ]]; then
    cat << 'EOF'
📦 FlowForge Project Archive

Creates a compressed archive of the current project, excluding common build artifacts and temporary files.

Usage: /flowforge:project:archive [name] [help]

Arguments:
  name       Custom archive name (optional)
  help, ?    Show this help message

Examples:
  /flowforge:project:archive                    # Creates project-YYYY-MM-DD.tar.gz
  /flowforge:project:archive "backup-v1.0"     # Creates backup-v1.0.tar.gz

Archive includes:
• Source code and configuration files
• Documentation and README files
• Tests and scripts
• FlowForge configuration

Archive excludes:
• node_modules/, dist/, build/ directories
• Git history (.git/)
• Temporary files and logs
• OS-specific files (.DS_Store, Thumbs.db)

The archive will be created in the current directory.

Prerequisites:
• tar or zip command-line tool
• Write permissions in current directory
• Sufficient disk space
• Git repository (project root)

Note: Large projects may take time to archive.
      Test extraction before relying on archive for backup.
EOF
    exit 0
fi

# Now enable strict error handling
set -euo pipefail

# Error handler function
handle_error() {
    local exit_code=$?
    local line_number=$1
    echo "❌ Error on line $line_number (exit code: $exit_code)"
    
    # Context-specific error messages
    if [[ "${BASH_COMMAND:-}" =~ "tar" ]]; then
        echo "💡 Archive creation failed"
        echo "   Check if tar is installed and you have write permissions"
        echo "   Ensure there's enough disk space"
        echo "   Some files might be protected or in use"
    elif [[ "${BASH_COMMAND:-}" =~ "zip" ]]; then
        echo "💡 ZIP archive creation failed"
        echo "   Check if zip is installed and you have write permissions"
        echo "   Ensure there's enough disk space"
        echo "   Some files might be protected or in use"
    elif [[ "${BASH_COMMAND:-}" =~ "df" ]]; then
        echo "💡 Unable to check disk space"
        echo "   Check filesystem permissions"
        echo "   Continue with caution - space might be limited"
    elif [[ "${BASH_COMMAND:-}" =~ "git" ]]; then
        echo "💡 Git operation failed"
        echo "   Ensure you're in a git repository"
        echo "   Navigate to your project root directory"
    elif [[ "${BASH_COMMAND:-}" =~ "jq" ]]; then
        echo "💡 JSON parsing failed"
        echo "   .flowforge/config.json might be malformed"
        echo "   Using fallback project name"
    elif [[ "${BASH_COMMAND:-}" =~ "stat\|ls" ]]; then
        echo "💡 File information retrieval failed"
        echo "   Archive may exist but size is unknown"
    elif [[ "${BASH_COMMAND:-}" =~ "chmod" ]]; then
        echo "💡 Permission operation failed"
        echo "   Some files may have restricted permissions"
        echo "   Archive might be incomplete"
    fi
    
    # Clean up any partial archives
    echo "🧹 Cleaning up partial archives..."
    rm -f "${ARCHIVE_NAME:-partial_archive.*}" 2>/dev/null || true
    
    exit $exit_code
}

# Set error trap
trap 'handle_error $LINENO' ERR

# Enable debug mode if DEBUG=1
[[ "${DEBUG:-0}" == "1" ]] && set -x
```

## 🔍 Validate Environment
```bash
# Check if we're in a git repository
if [ ! -d ".git" ]; then
    echo "❌ Error: Not in a git repository"
    echo "💡 Navigate to your project root directory"
    echo "   The directory should contain a .git folder"
    echo "   Use 'cd' to navigate to your project"
    exit 1
fi

# Check required tools and determine which to use
ARCHIVE_TOOL=""
ARCHIVE_EXT=""

if command -v tar >/dev/null 2>&1; then
    ARCHIVE_TOOL="tar"
    ARCHIVE_EXT=".tar.gz"
elif command -v zip >/dev/null 2>&1; then
    ARCHIVE_TOOL="zip"
    ARCHIVE_EXT=".zip"
else
    echo "❌ Error: No archiving tool found"
    echo "💡 Please install either 'tar' or 'zip'"
    echo "   On Ubuntu/Debian: sudo apt install tar"
    echo "   On CentOS/RHEL: sudo yum install tar"
    echo "   On macOS: tar is pre-installed"
    echo "   For zip:"
    echo "   On Ubuntu/Debian: sudo apt install zip"
    echo "   On CentOS/RHEL: sudo yum install zip"
    echo "   On macOS: zip is pre-installed"
    exit 1
fi

# Check available disk space (basic check)
if command -v df >/dev/null 2>&1; then
    AVAILABLE_SPACE=$(df . | tail -1 | awk '{print $4}' 2>/dev/null || echo "unknown")
    if [[ "$AVAILABLE_SPACE" =~ ^[0-9]+$ ]] && [ "$AVAILABLE_SPACE" -lt 10240 ]; then  # Less than 10MB
        echo "⚠️  Warning: Low disk space (less than 10MB available)"
        echo "💡 Consider cleaning up temporary files first"
        echo "   Run: rm -rf node_modules/ dist/ build/ *.log"
        echo "   Or choose a different location for the archive"
        echo ""
        read -p "Continue anyway? [y/N] " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            echo "✨ Archive cancelled. Free up space and try again."
            exit 0
        fi
    fi
fi

# Check write permissions in current directory
if [ ! -w "." ]; then
    echo "❌ Error: No write permission in current directory"
    echo "💡 Change to a directory where you have write access"
    echo "   Or run with appropriate permissions"
    exit 1
fi
```

## 📝 Determine Archive Name
```bash
# Get project name from various sources
PROJECT_NAME=$(basename "$(pwd)")

# Try to get project name from FlowForge config
if [ -f ".flowforge/config.json" ]; then
    if command -v jq >/dev/null 2>&1; then
        FLOWFORGE_NAME=$(jq -r '.project.name // empty' .flowforge/config.json 2>/dev/null || echo "")
        if [ -n "$FLOWFORGE_NAME" ] && [ "$FLOWFORGE_NAME" != "null" ]; then
            PROJECT_NAME="$FLOWFORGE_NAME"
        fi
    else
        # Fallback parsing without jq
        FLOWFORGE_NAME=$(grep -o '"name"[[:space:]]*:[[:space:]]*"[^"]*"' .flowforge/config.json 2>/dev/null | sed 's/.*"name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/' || echo "")
        if [ -n "$FLOWFORGE_NAME" ]; then
            PROJECT_NAME="$FLOWFORGE_NAME"
        fi
    fi
fi

# Try package.json if it exists
if [ -f "package.json" ] && [ -z "$FLOWFORGE_NAME" ]; then
    if command -v jq >/dev/null 2>&1; then
        PACKAGE_NAME=$(jq -r '.name // empty' package.json 2>/dev/null || echo "")
        if [ -n "$PACKAGE_NAME" ] && [ "$PACKAGE_NAME" != "null" ]; then
            PROJECT_NAME="$PACKAGE_NAME"
        fi
    fi
fi

# Use provided name or generate default
if [ -n "${ARGUMENTS:-}" ] && [ "${ARGUMENTS}" != "help" ] && [ "${ARGUMENTS}" != "?" ]; then
    ARCHIVE_NAME="${ARGUMENTS}"
else
    ARCHIVE_NAME="${PROJECT_NAME}-$(date +%Y-%m-%d)"
fi

# Add appropriate extension
ARCHIVE_NAME="${ARCHIVE_NAME}${ARCHIVE_EXT}"

# Check if archive already exists
if [ -f "$ARCHIVE_NAME" ]; then
    echo "❌ Error: Archive '$ARCHIVE_NAME' already exists"
    echo "💡 Choose a different name or remove the existing archive"
    echo "   Remove: rm '$ARCHIVE_NAME'"
    echo "   Or use: /flowforge:project:archive \"custom-name-$(date +%H%M%S)\""
    exit 1
fi
```

## 📦 Create Archive
```bash
echo "📦 Creating project archive..."
echo "🔧 Using $ARCHIVE_TOOL for compression"
echo "📁 Archive name: $ARCHIVE_NAME"
echo "📍 Location: $(pwd)/$ARCHIVE_NAME"
echo ""

# Define common exclusion patterns
EXCLUDE_PATTERNS=(
    '.git'
    'node_modules'
    'dist'
    'build'
    'target'
    '.pytest_cache'
    '__pycache__'
    'coverage'
    '.nyc_output'
    '*.log'
    '*.tmp'
    '*.temp'
    '.DS_Store'
    'Thumbs.db'
    '*.pyc'
    '*.pyo'
    '*.class'
    'bin'
    'obj'
    '*.o'
    '*.a'
    '*.so'
    '*.dylib'
    '*.dll'
    '.vscode/settings.json'
    '.idea/workspace.xml'
    '*.swp'
    '*.swo'
    '*~'
)

if [ "$ARCHIVE_TOOL" = "tar" ]; then
    # Create tar archive with exclusions using a more compatible approach
    echo "🔄 Creating tar.gz archive..."
    
    # Capture stderr to check for permission errors
    TAR_OUTPUT=$(tar -czf "$ARCHIVE_NAME" \
        --exclude='.git' \
        --exclude='node_modules' \
        --exclude='dist' \
        --exclude='build' \
        --exclude='target' \
        --exclude='.pytest_cache' \
        --exclude='__pycache__' \
        --exclude='coverage' \
        --exclude='.nyc_output' \
        --exclude='*.log' \
        --exclude='*.tmp' \
        --exclude='*.temp' \
        --exclude='.DS_Store' \
        --exclude='Thumbs.db' \
        --exclude='*.pyc' \
        --exclude='*.pyo' \
        --exclude='*.class' \
        --exclude='bin' \
        --exclude='obj' \
        --exclude='*.o' \
        --exclude='*.a' \
        --exclude='*.so' \
        --exclude='*.dylib' \
        --exclude='*.dll' \
        --exclude='.vscode/settings.json' \
        --exclude='.idea/workspace.xml' \
        --exclude='*.swp' \
        --exclude='*.swo' \
        --exclude='*~' \
        . 2>&1) && TAR_EXIT_CODE=0 || TAR_EXIT_CODE=$?
    
    if [ $TAR_EXIT_CODE -eq 0 ]; then
        echo "✅ Tar archive created successfully"
    else
        # Check if archive was partially created despite errors
        if [ -f "$ARCHIVE_NAME" ] && [ -s "$ARCHIVE_NAME" ]; then
            # Check for permission denied errors
            if echo "$TAR_OUTPUT" | grep -q "Permission denied\|cannot read\|cannot access"; then
                echo "⚠️  Archive created with some files skipped due to permissions"
                echo "💡 Some protected files were excluded from the archive"
                echo "   The archive is still usable but may be incomplete"
            else
                echo "⚠️  Archive created but with warnings"
                echo "💡 Check archive contents to ensure completeness"
            fi
        else
            echo "❌ Tar archive creation failed"
            echo "💡 This might be due to:"
            echo "   • Protected files or directories"
            echo "   • Insufficient disk space"  
            echo "   • Files in use by other processes"
            echo "   • Very large files exceeding limits"
            # Show actual error if available
            if [ -n "$TAR_OUTPUT" ]; then
                echo ""
                echo "Error details:"
                echo "$TAR_OUTPUT" | head -5 | sed 's/^/  /'
            fi
            exit 1
        fi
    fi
    
elif [ "$ARCHIVE_TOOL" = "zip" ]; then
    # Create zip archive with exclusions
    echo "🔄 Creating zip archive..."
    
    # Capture stderr to check for permission errors
    ZIP_OUTPUT=$(zip -r "$ARCHIVE_NAME" . \
        -x '.git/*' \
        -x 'node_modules/*' \
        -x 'dist/*' \
        -x 'build/*' \
        -x 'target/*' \
        -x '.pytest_cache/*' \
        -x '__pycache__/*' \
        -x 'coverage/*' \
        -x '.nyc_output/*' \
        -x '*.log' \
        -x '*.tmp' \
        -x '*.temp' \
        -x '.DS_Store' \
        -x 'Thumbs.db' \
        -x '*.pyc' \
        -x '*.pyo' \
        -x '*.class' \
        -x 'bin/*' \
        -x 'obj/*' \
        -x '*.o' \
        -x '*.a' \
        -x '*.so' \
        -x '*.dylib' \
        -x '*.dll' \
        -x '.vscode/settings.json' \
        -x '.idea/workspace.xml' \
        -x '*.swp' \
        -x '*.swo' \
        -x '*~' \
        2>&1) && ZIP_EXIT_CODE=0 || ZIP_EXIT_CODE=$?
    
    if [ $ZIP_EXIT_CODE -eq 0 ]; then
        echo "✅ Zip archive created successfully"
    else
        # Check if archive was partially created despite errors
        if [ -f "$ARCHIVE_NAME" ] && [ -s "$ARCHIVE_NAME" ]; then
            # Check for permission denied errors
            if echo "$ZIP_OUTPUT" | grep -q "Permission denied\|cannot read\|cannot access"; then
                echo "⚠️  Archive created with some files skipped due to permissions"
                echo "💡 Some protected files were excluded from the archive"
                echo "   The archive is still usable but may be incomplete"
            else
                echo "⚠️  Archive created but with warnings"
                echo "💡 Check archive contents to ensure completeness"
            fi
        else
            echo "❌ Zip archive creation failed"
            echo "💡 This might be due to:"
            echo "   • Protected files or directories"
            echo "   • Insufficient disk space"
            echo "   • Files in use by other processes"
            echo "   • Command line too long (too many files)"
            # Show actual error if available
            if [ -n "$ZIP_OUTPUT" ]; then
                echo ""
                echo "Error details:"
                echo "$ZIP_OUTPUT" | head -5 | sed 's/^/  /'
            fi
            exit 1
        fi
    fi
fi
```

## ✅ Verify and Report
```bash
# Verify archive was created and get information
if [ ! -f "$ARCHIVE_NAME" ]; then
    echo "❌ Error: Archive was not created"
    echo "💡 Check permissions and available disk space"
    echo "   Try creating archive in a different location"
    exit 1
fi

# Get archive size and info
echo ""
echo "======================================"
echo "✅ Archive created successfully!"
echo "======================================"
echo ""
echo "📦 Archive Details:"
echo "   Name: $ARCHIVE_NAME"
echo "   Location: $(pwd)"

# Get file size in human readable format
if command -v ls >/dev/null 2>&1; then
    if ls -lh "$ARCHIVE_NAME" >/dev/null 2>&1; then
        ARCHIVE_SIZE=$(ls -lh "$ARCHIVE_NAME" | awk '{print $5}')
        echo "   Size: $ARCHIVE_SIZE"
    fi
fi

# Count files in archive if possible
if [ "$ARCHIVE_TOOL" = "tar" ] && command -v tar >/dev/null 2>&1; then
    FILE_COUNT=$(tar -tzf "$ARCHIVE_NAME" 2>/dev/null | wc -l | tr -d ' ')
    if [ "$FILE_COUNT" -gt 0 ]; then
        echo "   Files: $FILE_COUNT"
    fi
elif [ "$ARCHIVE_TOOL" = "zip" ] && command -v unzip >/dev/null 2>&1; then
    FILE_COUNT=$(unzip -l "$ARCHIVE_NAME" 2>/dev/null | tail -1 | awk '{print $2}' | tr -d ' ')
    if [[ "$FILE_COUNT" =~ ^[0-9]+$ ]]; then
        echo "   Files: $FILE_COUNT"
    fi
fi

echo ""
echo "📋 What's included:"
echo "   ✅ Source code and configuration files"
echo "   ✅ Documentation and README files"
echo "   ✅ Tests and scripts"
echo "   ✅ FlowForge configuration"
echo ""
echo "🚫 What's excluded:"
echo "   • Build artifacts (dist/, build/, target/)"
echo "   • Dependencies (node_modules/)"
echo "   • Git history (.git/)"
echo "   • Temporary files (*.log, *.tmp)"
echo "   • OS-specific files (.DS_Store, Thumbs.db)"
echo ""
echo "💡 Usage tips:"
if [ "$ARCHIVE_TOOL" = "tar" ]; then
    echo "   • Extract with: tar -xzf '$ARCHIVE_NAME'"
    echo "   • List contents: tar -tzf '$ARCHIVE_NAME'"
elif [ "$ARCHIVE_TOOL" = "zip" ]; then
    echo "   • Extract with: unzip '$ARCHIVE_NAME'"
    echo "   • List contents: unzip -l '$ARCHIVE_NAME'"
fi
echo "   • Move to safe location for backup"
echo "   • Test extraction before relying on archive"
echo "   • Consider version control for source backup"
echo ""
echo "🎉 Archive ready for backup or distribution!"

# Clean up any temporary files
rm -f run_command.sh 2>/dev/null || true
```

**Claude, this command will:**
1. **Validate environment**: Check for git repo, archiving tools, disk space, permissions
2. **Handle help requests**: Show comprehensive help before enabling strict mode
3. **Determine archive name**: Smart detection from FlowForge config, package.json, or directory
4. **Create archive with exclusions**: Comprehensive exclusion patterns for clean archives
5. **Provide detailed feedback**: File counts, sizes, and usage instructions
6. **Robust error handling**: Context-specific error messages and cleanup