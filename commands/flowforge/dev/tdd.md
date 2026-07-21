# Command: flowforge:dev:tdd
# Version: 2.0.0
# Description: FlowForge dev tdd command

---
description: Start Test-Driven Development workflow - Red, Green, Refactor!
argument-hint: "<feature-description>"
---

# 🧪 Test-Driven Development Helper

**TDD Cycle**: Write failing test → Make it pass → Refactor → Repeat

This command helps you follow TDD best practices:
- Creates test files from templates
- Runs tests automatically  
- Tracks test coverage
- Ensures Rule #3 compliance (80%+ coverage)

Remember: No code without tests first!

```bash
set -euo pipefail  # Exit on error, undefined vars, pipe failures

# Error handler
handle_error() {
    local exit_code=$?
    local line_number=$1
    echo "❌ Error on line $line_number (exit code: $exit_code)"
    echo "💡 Debug with: DEBUG=1 /flowforge:dev:tdd"
    exit $exit_code
}
trap 'handle_error $LINENO' ERR

# Debug mode
[[ "${DEBUG:-0}" == "1" ]] && set -x

# Check for help request
if [[ "${ARGUMENTS:-}" == "?" || "${ARGUMENTS:-}" == "help" ]]; then
    cat << 'HELP'
🧪 FlowForge TDD Helper

Usage: /flowforge:dev:tdd <feature-description>

What it does:
✓ Creates test file from templates
✓ Runs tests in watch mode
✓ Shows coverage reports
✓ Enforces TDD workflow

TDD Cycle:
1. RED: Write a failing test
2. GREEN: Write minimal code to pass
3. REFACTOR: Improve code with tests passing

Examples:
  /flowforge:dev:tdd "user authentication"
  /flowforge:dev:tdd "calculate shipping costs"
  /flowforge:dev:tdd ?                      # Show this help

Options:
  <feature-description>  Required feature to test
  ?/help                Show this help
  DEBUG=1               Enable debug output

Rule #3: Tests MUST be written before code!
Coverage target: 80%+ for all code
HELP
    exit 0
fi

# Validate arguments
if [ -z "${ARGUMENTS:-}" ]; then
    echo "❌ Missing feature description!"
    echo "💡 Usage: /flowforge:dev:tdd <feature-description>"
    echo "   Example: /flowforge:dev:tdd \"user authentication\""
    exit 1
fi

echo "🧪 Starting TDD workflow for: $ARGUMENTS"

# Check git repository
if ! git rev-parse --git-dir &>/dev/null; then
    echo "❌ Not in a git repository!"
    echo "💡 Initialize with: git init"
    exit 1
fi

# Get project info
PROJECT_TYPE="unknown"
TEST_COMMAND=""
TEST_DIR=""
TEST_EXTENSION=""

# Detect project type and test setup
if [ -f "package.json" ]; then
    PROJECT_TYPE="javascript"
    TEST_DIR="tests"
    TEST_EXTENSION="test.js"
    
    # Check for test command
    if grep -q '"test"' package.json 2>/dev/null; then
        TEST_COMMAND="npm test"
        
        # Detect test framework
        if grep -q "jest" package.json 2>/dev/null; then
            echo "✅ Detected: Jest test framework"
            TEST_EXTENSION="test.js"
        elif grep -q "mocha" package.json 2>/dev/null; then
            echo "✅ Detected: Mocha test framework"
            TEST_EXTENSION="spec.js"
        elif grep -q "vitest" package.json 2>/dev/null; then
            echo "✅ Detected: Vitest test framework"
            TEST_EXTENSION="test.js"
        fi
    fi
elif [ -f "Makefile" ] && grep -q "^test:" Makefile 2>/dev/null; then
    PROJECT_TYPE="make"
    TEST_DIR="tests"
    TEST_EXTENSION="test.sh"
    TEST_COMMAND="make test"
    echo "✅ Detected: Makefile with test target"
elif [ -f "setup.py" ] || [ -f "requirements.txt" ]; then
    PROJECT_TYPE="python"
    TEST_DIR="tests"
    TEST_EXTENSION="test.py"
    TEST_COMMAND="python -m pytest"
    echo "✅ Detected: Python project"
elif [ -f "Cargo.toml" ]; then
    PROJECT_TYPE="rust"
    TEST_DIR="tests"
    TEST_EXTENSION="rs"
    TEST_COMMAND="cargo test"
    echo "✅ Detected: Rust project"
else
    # Default to shell scripts
    PROJECT_TYPE="shell"
    TEST_DIR="tests"
    TEST_EXTENSION="test.sh"
    TEST_COMMAND="bash tests/run-tests.sh"
    echo "ℹ️  No specific test framework detected, using shell scripts"
fi

# Create test directory if needed
if [ ! -d "$TEST_DIR" ]; then
    echo "📁 Creating test directory: $TEST_DIR/"
    mkdir -p "$TEST_DIR"
fi

# Generate test file name
FEATURE_NAME=$(echo "$ARGUMENTS" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/_/g')
TEST_FILE="$TEST_DIR/${FEATURE_NAME}.$TEST_EXTENSION"

# Check if test already exists
if [ -f "$TEST_FILE" ]; then
    echo "✅ Test file already exists: $TEST_FILE"
    echo "📝 Opening for editing..."
else
    echo "📝 Creating test file: $TEST_FILE"
    
    # Create test from template or default
    case "$PROJECT_TYPE" in
        "javascript")
            cat > "$TEST_FILE" << EOF
// Test: $ARGUMENTS
// Created: $(date +%Y-%m-%d)
// TDD: Write test first, then implementation

describe('$ARGUMENTS', () => {
    it('should [describe expected behavior]', () => {
        // Arrange
        // TODO: Set up test data
        
        // Act
        // TODO: Call the function
        
        // Assert
        // TODO: Verify the result
        expect(true).toBe(false); // This should fail!
    });
});
EOF
            ;;
        "python")
            cat > "$TEST_FILE" << EOF
"""Test: $ARGUMENTS
Created: $(date +%Y-%m-%d)
TDD: Write test first, then implementation
"""

import pytest


def test_${FEATURE_NAME}_basic():
    """Test basic functionality of $ARGUMENTS"""
    # Arrange
    # TODO: Set up test data
    
    # Act
    # TODO: Call the function
    
    # Assert
    # TODO: Verify the result
    assert False, "Test not implemented yet!"


def test_${FEATURE_NAME}_edge_case():
    """Test edge cases for $ARGUMENTS"""
    # TODO: Implement edge case tests
    pass
EOF
            ;;
        "rust")
            cat > "$TEST_FILE" << EOF
// Test: $ARGUMENTS
// Created: $(date +%Y-%m-%d)
// TDD: Write test first, then implementation

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_${FEATURE_NAME}() {
        // Arrange
        // TODO: Set up test data
        
        // Act
        // TODO: Call the function
        
        // Assert
        // TODO: Verify the result
        assert!(false, "Test not implemented yet!");
    }
}
EOF
            ;;
        *)
            cat > "$TEST_FILE" << EOF
#!/bin/bash
# Test: $ARGUMENTS
# Created: $(date +%Y-%m-%d)
# TDD: Write test first, then implementation

set -euo pipefail

# Test setup
echo "🧪 Testing: $ARGUMENTS"

# Test 1: Basic functionality
test_basic() {
    echo "  Testing basic functionality..."
    
    # Arrange
    # TODO: Set up test data
    
    # Act
    # TODO: Call the function
    
    # Assert
    # TODO: Verify the result
    echo "❌ Test not implemented yet!"
    return 1
}

# Run tests
TESTS_PASSED=0
TESTS_FAILED=0

if test_basic; then
    ((TESTS_PASSED++))
    echo "✅ Basic test passed"
else
    ((TESTS_FAILED++))
    echo "❌ Basic test failed"
fi

# Summary
echo ""
echo "Results: $TESTS_PASSED passed, $TESTS_FAILED failed"

# Exit with failure if any test failed
[[ $TESTS_FAILED -eq 0 ]]
EOF
            chmod +x "$TEST_FILE"
            ;;
    esac
    
    echo "✅ Test file created: $TEST_FILE"
fi

# Step 1: Run the test (it should fail)
echo -e "\n🔴 Step 1: Running test (expecting failure)..."

if [ -n "$TEST_COMMAND" ]; then
    if $TEST_COMMAND 2>&1 | tail -20; then
        echo "⚠️  Test passed but should have failed!"
        echo "💡 Make sure your test actually tests something"
    else
        echo "✅ Good! Test failed as expected (RED phase)"
        echo ""
        echo "📝 Next steps:"
        echo "1. Review the failing test in: $TEST_FILE"
        echo "2. Write minimal code to make it pass"
        echo "3. Run: $TEST_COMMAND"
        echo "4. Refactor once test is green"
    fi
else
    echo "⚠️  No test command configured"
    echo "💡 Add test script to your project"
fi

# Show coverage if available
echo -e "\n📊 Coverage Report:"
if [ -f "coverage/lcov-report/index.html" ]; then
    echo "✅ Coverage report available"
    echo "   View: coverage/lcov-report/index.html"
elif [ -f "htmlcov/index.html" ]; then
    echo "✅ Coverage report available"
    echo "   View: htmlcov/index.html"
elif [ -f "coverage.xml" ]; then
    if command -v coverage &>/dev/null; then
        coverage report 2>/dev/null | tail -10 || echo "⚠️  Could not read coverage"
    fi
else
    echo "ℹ️  No coverage data found"
    echo "💡 Configure coverage in your test setup"
fi

# Git integration
echo -e "\n🔄 Git Integration:"
if [ -f ".git/hooks/pre-commit" ]; then
    echo "✅ Pre-commit hook detected"
    echo "   Tests will run before commits"
else
    echo "💡 Consider adding pre-commit hook for TDD"
    echo "   Run: /flowforge:dev:setup-hooks"
fi

# Watch mode suggestion
echo -e "\n⚡ Quick Commands:"
echo "  Watch tests: $TEST_COMMAND --watch"
echo "  Run specific: $TEST_COMMAND $TEST_FILE"
echo "  Coverage: $TEST_COMMAND --coverage"

# Final reminder
echo -e "\n🎯 Remember the TDD Rules:"
echo "  1. Write test first (you just did! ✅)"
echo "  2. Write minimal code to pass"
echo "  3. Refactor with confidence"
echo "  4. Maintain 80%+ coverage (Rule #3)"

# Open test file in editor if possible
if command -v code &>/dev/null; then
    echo -e "\n📝 Opening test in VS Code..."
    code "$TEST_FILE"
elif command -v vim &>/dev/null; then
    echo -e "\n💡 Edit test with: vim $TEST_FILE"
fi

exit 0
```
