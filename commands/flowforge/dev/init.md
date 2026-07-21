# Command: flowforge:dev:init
# Version: 2.0.0
# Description: FlowForge dev init command

---
description: Initialize FlowForge development environment in existing project
argument-hint: "[help]"
---

# 🔧 FlowForge Development Initialization

Initialize FlowForge development tools and workflow in an existing project.
This sets up hooks, templates, and development configurations for enhanced productivity.

**Note**: Use `/flowforge:project:setup` for new projects. This command is for existing projects that need FlowForge development tools.

```bash
# Check if help is requested FIRST (before strict mode)
if [[ "${ARGUMENTS:-}" == "?" || "${ARGUMENTS:-}" == "help" ]]; then
    cat << 'EOF'
🔧 FlowForge Development Initialization

Initialize FlowForge development environment in an existing project.

Usage: /flowforge:dev:init [help]

Arguments:
  help, ?    Show this help message

What it does:
  • Sets up git hooks for FlowForge workflow
  • Creates development templates
  • Configures error handling patterns
  • Initializes testing framework
  • Sets up time tracking
  • Creates development documentation

Prerequisites:
  - Git repository (git init)
  - Node.js (optional, for enhanced features)
  - Bash-compatible shell

Difference from project:setup:
  - project:setup: Creates new project from scratch
  - dev:init: Adds FlowForge to existing project

Examples:
  /flowforge:dev:init           # Initialize development environment
  /flowforge:dev:init ?         # Show this help
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
    if [[ "${BASH_COMMAND:-}" =~ "git" ]]; then
        echo "💡 Git operation failed"
        echo "   Ensure you're in a git repository: git init"
        echo "   Check git configuration: git config --list"
    elif [[ "${BASH_COMMAND:-}" =~ "mkdir" ]]; then
        echo "💡 Directory creation failed"
        echo "   Check permissions in current directory"
        echo "   Try: sudo chown -R $USER:$USER ."
    elif [[ "${BASH_COMMAND:-}" =~ "cp\|mv" ]]; then
        echo "💡 File operation failed"
        echo "   Check file permissions and disk space"
    elif [[ "${BASH_COMMAND:-}" =~ "chmod" ]]; then
        echo "💡 Permission change failed"
        echo "   Check if you own the file"
        echo "   Try: ls -la to see permissions"
    fi
    
    # Cleanup any partial initialization
    echo "🧹 Cleaning up partial initialization..."
    rm -f .flowforge/.dev-init-temp 2>/dev/null || true
    
    exit $exit_code
}

# Set error trap
trap 'handle_error $LINENO' ERR

# Enable debug mode if DEBUG=1
[[ "${DEBUG:-0}" == "1" ]] && set -x

# Handle non-interactive mode (skip for testing)
if [[ "${FLOWFORGE_TEST:-}" != "true" ]]; then
    if [[ ! -t 0 ]] || [[ "${CI:-false}" == "true" ]]; then
        echo "❌ Error: This command requires interactive mode"
        echo "💡 Run this command in an interactive terminal"
        exit 1
    fi
fi

echo "🔧 FlowForge Development Initialization"
echo "======================================"

# Check if git repository exists
if ! git rev-parse --git-dir &>/dev/null; then
    echo "❌ Not in a git repository!"
    echo "💡 Initialize git first: git init"
    echo "   Then run this command again"
    exit 1
fi

echo "✅ Git repository detected"

# Check if already initialized
if [[ -f ".flowforge/.dev-init-complete" ]]; then
    echo "✅ FlowForge development environment already initialized!"
    echo ""
    echo "🔧 Available development commands:"
    echo "   • /flowforge:dev:tdd     - Test-driven development"
    echo "   • /flowforge:dev:status  - Development status"
    echo "   • /flowforge:dev:checkrules - Rule compliance"
    echo ""
    echo "💡 To reinitialize, remove: .flowforge/.dev-init-complete"
    exit 0
fi

# Create temporary marker for cleanup
mkdir -p .flowforge
touch .flowforge/.dev-init-temp

echo "🔍 Checking dependencies..."

# Check required dependencies
MISSING_DEPS=()

# Check git (already verified above, but check version)
if ! git --version &>/dev/null; then
    MISSING_DEPS+=("git")
else
    echo "✅ Git: $(git --version | head -1)"
fi

# Check bash
if ! bash --version &>/dev/null; then
    MISSING_DEPS+=("bash")
else
    echo "✅ Bash: $(bash --version | head -1)"
fi

# Optional dependencies with warnings
OPTIONAL_MISSING=()

# Check Node.js (optional)
if ! node --version &>/dev/null; then
    OPTIONAL_MISSING+=("node")
else
    echo "✅ Node.js: $(node --version)"
fi

# Check npm (optional)
if ! npm --version &>/dev/null; then
    OPTIONAL_MISSING+=("npm")
else
    echo "✅ npm: $(npm --version)"
fi

# Report missing dependencies
if [[ ${#MISSING_DEPS[@]} -gt 0 ]]; then
    echo "❌ Missing required dependencies:"
    for dep in "${MISSING_DEPS[@]}"; do
        echo "   • $dep"
    done
    echo ""
    echo "💡 Install missing dependencies and try again"
    exit 1
fi

if [[ ${#OPTIONAL_MISSING[@]} -gt 0 ]]; then
    echo "⚠️  Optional dependencies missing (reduced functionality):"
    for dep in "${OPTIONAL_MISSING[@]}"; do
        echo "   • $dep"
    done
    echo ""
fi

echo "🏗️  Setting up FlowForge development environment..."

# Create .flowforge directory structure
echo "📁 Creating directory structure..."
mkdir -p .flowforge/{hooks,templates/tests,scripts,docs}
mkdir -p tests/{unit,integration}
mkdir -p documentation/development

echo "✅ Directory structure created"

# Setup git hooks
echo "🪝 Setting up git hooks..."

# Pre-commit hook for basic checks
if [[ ! -f ".git/hooks/pre-commit" ]]; then
    cat > .git/hooks/pre-commit << 'EOF'
#!/bin/bash
# FlowForge pre-commit hook
# Auto-generated by /flowforge:dev:init

set -euo pipefail

echo "🔍 FlowForge pre-commit checks..."

# Check for debugging statements
if git diff --cached --name-only | grep -E '\.(js|ts|py|sh)$' | xargs grep -l "console\.log\|debugger\|pdb\.set_trace\|binding\.pry" 2>/dev/null; then
    echo "⚠️  Warning: Debug statements found in staged files"
    echo "   Remove before committing or use --no-verify to skip"
fi

# Check for large files
if git diff --cached --name-only | xargs ls -la 2>/dev/null | awk '$5 > 1048576 {print $9 " (" $5 " bytes)"}' | grep -q .; then
    echo "⚠️  Warning: Large files detected (>1MB)"
    git diff --cached --name-only | xargs ls -la 2>/dev/null | awk '$5 > 1048576 {print "   • " $9 " (" $5 " bytes)"}'
fi

echo "✅ Pre-commit checks passed"
EOF
    chmod +x .git/hooks/pre-commit
    echo "✅ Pre-commit hook installed"
else
    echo "ℹ️  Pre-commit hook already exists (not overwritten)"
fi

# Create test templates
echo "📋 Creating test templates..."

# Shell test template
cat > .flowforge/templates/tests/test-template.sh << 'EOF'
#!/bin/bash
# Test Template for FlowForge
# Usage: Copy this template for new test files

set -euo pipefail

# Test setup
setup_test() {
    # Add test setup here
    echo "Setting up test environment..."
}

# Test cleanup
cleanup_test() {
    # Add cleanup here
    echo "Cleaning up test environment..."
}

# Example test function
test_example_function() {
    echo "Testing example function..."
    
    # Arrange
    local input="test_input"
    local expected="expected_output"
    
    # Act
    local actual="actual_output"  # Replace with function call
    
    # Assert
    if [[ "$actual" == "$expected" ]]; then
        echo "✅ Test passed"
        return 0
    else
        echo "❌ Test failed: expected '$expected', got '$actual'"
        return 1
    fi
}

# Run tests
main() {
    echo "🧪 Running tests..."
    
    setup_test
    
    local tests_passed=0
    local tests_failed=0
    
    # Run individual tests
    if test_example_function; then
        ((tests_passed++))
    else
        ((tests_failed++))
    fi
    
    cleanup_test
    
    # Summary
    echo ""
    echo "📊 Results: $tests_passed passed, $tests_failed failed"
    
    # Exit with error if any test failed
    [[ $tests_failed -eq 0 ]]
}

# Run if executed directly
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi
EOF

echo "✅ Test templates created"

# Create development scripts
echo "🔧 Creating development scripts..."

# Test runner script
cat > .flowforge/scripts/run-tests.sh << 'EOF'
#!/bin/bash
# FlowForge Test Runner
# Runs all tests in the project

set -euo pipefail

echo "🧪 FlowForge Test Runner"
echo "======================="

# Find and run all test files
TESTS_FOUND=0
TESTS_PASSED=0
TESTS_FAILED=0

# Run shell tests
for test_file in tests/**/*.sh; do
    if [[ -f "$test_file" && -x "$test_file" ]]; then
        echo ""
        echo "Running: $test_file"
        ((TESTS_FOUND++))
        
        if "$test_file"; then
            ((TESTS_PASSED++))
            echo "✅ $test_file passed"
        else
            ((TESTS_FAILED++))
            echo "❌ $test_file failed"
        fi
    fi
done

# Run JavaScript tests if available
if [[ -f "package.json" ]] && grep -q '"test"' package.json; then
    echo ""
    echo "Running npm tests..."
    if npm test; then
        echo "✅ npm test passed"
    else
        echo "❌ npm test failed"
    fi
fi

# Run Python tests if available
if [[ -f "requirements.txt" ]] || [[ -f "setup.py" ]]; then
    if command -v pytest &>/dev/null; then
        echo ""
        echo "Running pytest..."
        if pytest; then
            echo "✅ pytest passed"
        else
            echo "❌ pytest failed"
        fi
    fi
fi

echo ""
echo "📊 Test Summary:"
echo "   Found: $TESTS_FOUND shell tests"
echo "   Passed: $TESTS_PASSED"
echo "   Failed: $TESTS_FAILED"

[[ $TESTS_FAILED -eq 0 ]]
EOF
chmod +x .flowforge/scripts/run-tests.sh

echo "✅ Development scripts created"

# Create basic documentation
echo "📚 Creating development documentation..."

cat > documentation/development/README.md << 'EOF'
# 🔧 Development Guide

Welcome to the development environment! This project uses FlowForge for enhanced productivity.

## 🚀 Quick Start

```bash
# Run all tests
./.flowforge/scripts/run-tests.sh

# Start TDD workflow
/flowforge:dev:tdd "new feature"

# Check development status
/flowforge:dev:status

# Validate rules compliance
/flowforge:dev:checkrules
```

## 🧪 Testing

### Running Tests
- All tests: `./.flowforge/scripts/run-tests.sh`
- Single test: `./tests/unit/test-name.sh`

### Creating Tests
1. Copy template: `cp .flowforge/templates/tests/test-template.sh tests/unit/test-new-feature.sh`
2. Edit test file with specific test cases
3. Make executable: `chmod +x tests/unit/test-new-feature.sh`
4. Run: `./tests/unit/test-new-feature.sh`

## 🪝 Git Hooks

Pre-commit hook automatically:
- Checks for debug statements
- Warns about large files
- Validates basic code quality

## 📋 Development Workflow

1. **Start**: Use `/flowforge:dev:tdd` for test-driven development
2. **Test**: Write tests first, then implementation
3. **Commit**: Pre-commit hooks ensure quality
4. **Status**: Check progress with `/flowforge:dev:status`

## 🔧 FlowForge Commands

- `/flowforge:dev:init` - Initialize development environment
- `/flowforge:dev:tdd` - Test-driven development helper
- `/flowforge:dev:status` - Show development status
- `/flowforge:dev:checkrules` - Validate FlowForge rules

## 📁 Directory Structure

```
.flowforge/
├── hooks/          # Custom hooks
├── templates/      # File templates
├── scripts/        # Development scripts
└── docs/          # FlowForge documentation

tests/
├── unit/          # Unit tests
└── integration/   # Integration tests

documentation/
└── development/   # Development guides
```

---
Generated by FlowForge Development Initialization
EOF

echo "✅ Development documentation created"

# Configure project-specific settings
echo "⚙️  Configuring project settings..."

# Detect project type and create appropriate configs
PROJECT_TYPE="unknown"

if [[ -f "package.json" ]]; then
    PROJECT_TYPE="javascript"
    echo "✅ Detected: JavaScript/Node.js project"
    
    # Add test script if missing
    if ! grep -q '"test"' package.json 2>/dev/null; then
        echo "💡 Consider adding test script to package.json"
        echo '   "test": "jest" or "mocha" or appropriate test command'
    fi
    
elif [[ -f "requirements.txt" ]] || [[ -f "setup.py" ]]; then
    PROJECT_TYPE="python"
    echo "✅ Detected: Python project"
    
    # Suggest pytest if not found
    if ! command -v pytest &>/dev/null; then
        echo "💡 Consider installing pytest: pip install pytest"
    fi
    
elif [[ -f "Cargo.toml" ]]; then
    PROJECT_TYPE="rust"
    echo "✅ Detected: Rust project"
    
elif [[ -f "go.mod" ]] || [[ -f "go.sum" ]]; then
    PROJECT_TYPE="go"
    echo "✅ Detected: Go project"
    
else
    PROJECT_TYPE="shell"
    echo "ℹ️  Generic project detected - using shell-based tools"
fi

# Save project type
echo "$PROJECT_TYPE" > .flowforge/.project-type

# Create project-specific configurations
case "$PROJECT_TYPE" in
    "javascript")
        # Create jest config template if needed
        if [[ ! -f "jest.config.js" ]] && command -v jest &>/dev/null; then
            cat > jest.config.js << 'EOF'
module.exports = {
  testEnvironment: 'node',
  coverageDirectory: 'coverage',
  collectCoverageFrom: [
    'src/**/*.{js,ts}',
    '!src/**/*.test.{js,ts}',
    '!src/**/*.spec.{js,ts}'
  ],
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80
    }
  }
};
EOF
            echo "✅ Jest configuration created"
        fi
        ;;
    "python")
        # Create pytest config
        if [[ ! -f "pytest.ini" ]]; then
            cat > pytest.ini << 'EOF'
[tool:pytest]
testpaths = tests
python_files = test_*.py
python_classes = Test*
python_functions = test_*
addopts = 
    --verbose
    --tb=short
    --cov=src
    --cov-report=html
    --cov-report=term-missing
    --cov-fail-under=80
EOF
            echo "✅ Pytest configuration created"
        fi
        ;;
esac

# Final setup steps
echo "🎯 Finalizing setup..."

# Mark initialization complete
rm -f .flowforge/.dev-init-temp
touch .flowforge/.dev-init-complete
date +%Y-%m-%d > .flowforge/.dev-init-date

# Set appropriate permissions
chmod -R 755 .flowforge/scripts/ 2>/dev/null || true

echo ""
echo "════════════════════════════════════════════════════════"
echo "✅ FlowForge Development Initialization Complete!"
echo "════════════════════════════════════════════════════════"
echo ""
echo "📋 What was set up:"
echo "   • Git hooks for quality checks"
echo "   • Test templates and runner"
echo "   • Development scripts"
echo "   • Documentation structure"
echo "   • Project-specific configurations"
echo ""
echo "🚀 Next steps:"
echo "   1. Run tests: ./.flowforge/scripts/run-tests.sh"
echo "   2. Start TDD: /flowforge:dev:tdd \"your feature\""
echo "   3. Check status: /flowforge:dev:status"
echo ""
echo "🔧 Available commands:"
echo "   • /flowforge:dev:tdd     - Test-driven development"
echo "   • /flowforge:dev:status  - Development status"
echo "   • /flowforge:dev:checkrules - Rule compliance"
echo ""
echo "📚 Documentation: documentation/development/README.md"
echo ""
echo "Happy coding with FlowForge! 🎉"

# Clean up
rm -f run_command.sh 2>/dev/null || true

# Debug info
if [[ "${DEBUG:-0}" == "1" ]]; then
    echo ""
    echo "🔍 Debug Info:"
    echo "  Project Type: $PROJECT_TYPE"
    echo "  Init Date: $(date)"
    echo "  Working Directory: $(pwd)"
    echo "  Git Repository: $(git rev-parse --show-toplevel 2>/dev/null || echo "N/A")"
fi
```