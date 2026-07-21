# Command: flowforge:team:report
# Version: 2.0.0
# Description: Generate comprehensive team reports from Git-tracked data
# Issue: #548 - Git-Integrated Namespace System

---
description: Generate time tracking and activity reports for the team
---

# 📊 FlowForge Team Report Generator

## 🔧 Setup Error Handling
```bash
# Enable strict error handling
set -euo pipefail

# Error handler function
handle_error() {
    local exit_code=$?
    local line_number=$1
    echo "❌ Error on line $line_number (exit code: $exit_code)"

    # Provide helpful error messages
    if [[ "${BASH_COMMAND:-}" =~ "jq" ]]; then
        echo "💡 JSON processing failed - check data integrity"
    elif [[ "${BASH_COMMAND:-}" =~ "bc" ]]; then
        echo "💡 Calculation error - install bc package"
    fi

    exit $exit_code
}

# Set error trap
trap 'handle_error $LINENO' ERR

# Enable debug mode if DEBUG=1
[[ "${DEBUG:-0}" == "1" ]] && set -x
```

## 📚 Show Help
```bash
# Check if help is requested
if [[ "${ARGUMENTS:-}" == "?" || "${ARGUMENTS:-}" == "help" ]]; then
    cat << 'EOF'
📊 FlowForge Team Report Generator

Generate comprehensive team reports from Git-tracked namespace data.

Usage: /flowforge:team:report [period] [format] [options]

Period (default: daily):
  daily          Today's activity
  weekly         Current week's activity
  monthly        Current month's activity

Format (default: markdown):
  markdown       Human-readable markdown format
  json           Machine-readable JSON format
  csv            Spreadsheet-compatible CSV format

Options:
  --timezone TZ  Set report timezone (default: UTC)
  --output FILE  Save report to file
  --email        Email report (requires config)
  help, ?        Show this help message

Examples:
  /flowforge:team:report                    # Daily markdown report
  /flowforge:team:report weekly json        # Weekly JSON report
  /flowforge:team:report monthly csv        # Monthly CSV export
  /flowforge:team:report daily markdown --output report.md

Report includes:
  • Developer time tracking by task
  • Total hours per developer
  • Task completion metrics
  • Session activity patterns
  • Team productivity trends

Related commands:
  /flowforge:team:status     View current team status
  /flowforge:metrics:report  Generate project metrics

EOF
    exit 0
fi
```

## 🔍 Parse Options
```bash
# Initialize defaults
REPORT_PERIOD="daily"
REPORT_FORMAT="markdown"
OUTPUT_FILE=""
TIMEZONE="UTC"
SEND_EMAIL=false

# Parse arguments
ARGS=($ARGUMENTS)
ARG_COUNT=0

for arg in ${ARGUMENTS:-}; do
    case "$arg" in
        # Periods
        daily|weekly|monthly|billable)
            REPORT_PERIOD="$arg"
            ;;

        # Formats
        markdown|json|csv)
            REPORT_FORMAT="$arg"
            ;;

        # Options
        --timezone)
            # Next argument is timezone value
            TIMEZONE="${ARGS[$((ARG_COUNT + 1))]:-UTC}"
            ;;

        --output)
            # Next argument is output file
            OUTPUT_FILE="${ARGS[$((ARG_COUNT + 1))]:-}"
            ;;

        --email)
            SEND_EMAIL=true
            ;;

        --*)
            if [[ ! "$arg" =~ ^--(timezone|output) ]]; then
                echo "⚠️  Unknown option: $arg"
            fi
            ;;
    esac
    ARG_COUNT=$((ARG_COUNT + 1))
done

# Export timezone for script
export REPORT_TIMEZONE="$TIMEZONE"
```

## 🛠️ Locate Team Report Script
```bash
# Find the team-report.sh script
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

# Try multiple locations for the script
TEAM_REPORT_SCRIPT=""
for location in \
    "$PROJECT_ROOT/scripts/namespace/team-report.sh" \
    "$SCRIPT_DIR/../../../scripts/namespace/team-report.sh" \
    "$(dirname "$0")/../../../scripts/namespace/team-report.sh"; do
    if [[ -f "$location" ]]; then
        TEAM_REPORT_SCRIPT="$location"
        break
    fi
done

# Verify script found
if [[ -z "$TEAM_REPORT_SCRIPT" ]]; then
    echo "❌ Error: team-report.sh script not found"
    echo "💡 Ensure FlowForge is properly installed"
    exit 1
fi
```

## 📊 Generate Report
```bash
echo "📊 Generating Team Report"
echo "========================"
echo "Period: $REPORT_PERIOD"
echo "Format: $REPORT_FORMAT"
echo "Timezone: $TIMEZONE"
echo ""

# Generate report and capture output
if [[ -n "$OUTPUT_FILE" ]]; then
    echo "📝 Writing report to: $OUTPUT_FILE"

    # Ensure output directory exists
    OUTPUT_DIR="$(dirname "$OUTPUT_FILE")"
    mkdir -p "$OUTPUT_DIR" 2>/dev/null || true

    # Generate report to file
    bash "$TEAM_REPORT_SCRIPT" report "$REPORT_PERIOD" "$REPORT_FORMAT" > "$OUTPUT_FILE"

    if [[ -f "$OUTPUT_FILE" ]]; then
        echo "✅ Report saved successfully"

        # Show preview for text formats
        if [[ "$REPORT_FORMAT" != "json" ]]; then
            echo ""
            echo "Preview (first 20 lines):"
            echo "------------------------"
            head -n 20 "$OUTPUT_FILE"
            echo "..."
            echo ""
            echo "Full report saved to: $OUTPUT_FILE"
        fi
    else
        echo "❌ Failed to save report"
        exit 1
    fi
else
    # Generate report to stdout
    bash "$TEAM_REPORT_SCRIPT" report "$REPORT_PERIOD" "$REPORT_FORMAT"
fi
```

## 📧 Email Report (if requested)
```bash
if [[ "$SEND_EMAIL" == "true" ]]; then
    echo ""
    echo "📧 Email Report"
    echo "=============="

    # Check for email configuration
    EMAIL_CONFIG="$HOME/.flowforge/email.conf"

    if [[ -f "$EMAIL_CONFIG" ]]; then
        source "$EMAIL_CONFIG"

        if [[ -n "${EMAIL_TO:-}" ]] && [[ -n "${EMAIL_FROM:-}" ]]; then
            # Prepare email content
            TEMP_REPORT="/tmp/flowforge-report-$$.txt"

            if [[ -n "$OUTPUT_FILE" ]]; then
                cp "$OUTPUT_FILE" "$TEMP_REPORT"
            else
                bash "$TEAM_REPORT_SCRIPT" report "$REPORT_PERIOD" "$REPORT_FORMAT" > "$TEMP_REPORT"
            fi

            # Send email (using mail command or configured service)
            SUBJECT="FlowForge Team Report - $REPORT_PERIOD ($(date +%Y-%m-%d))"

            if command -v mail >/dev/null 2>&1; then
                mail -s "$SUBJECT" "$EMAIL_TO" < "$TEMP_REPORT"
                echo "✅ Report emailed to: $EMAIL_TO"
            else
                echo "⚠️  Mail command not available"
                echo "💡 Install mailutils or configure SMTP"
            fi

            # Clean up
            rm -f "$TEMP_REPORT"
        else
            echo "⚠️  Email not configured"
            echo "💡 Set EMAIL_TO and EMAIL_FROM in ~/.flowforge/email.conf"
        fi
    else
        echo "⚠️  Email configuration not found"
        echo "💡 Create ~/.flowforge/email.conf with:"
        echo "   EMAIL_TO=\"team@example.com\""
        echo "   EMAIL_FROM=\"flowforge@example.com\""
    fi
fi
```

## 📈 Show Summary Statistics
```bash
# Add summary statistics for non-JSON formats
if [[ "$REPORT_FORMAT" != "json" ]] && [[ -z "$OUTPUT_FILE" ]]; then
    echo ""
    echo "📈 Report Summary"
    echo "================"

    # Get FlowForge root
    FLOWFORGE_ROOT="${FLOWFORGE_ROOT_OVERRIDE:-$PROJECT_ROOT/.flowforge}"

    # Count active developers
    ACTIVE_DEVS=$(find "$FLOWFORGE_ROOT/developers" -maxdepth 1 -type d 2>/dev/null | wc -l)
    ACTIVE_DEVS=$((ACTIVE_DEVS - 1))  # Subtract parent directory

    echo "👥 Active developers: $ACTIVE_DEVS"

    # Count today's sessions
    TODAY=$(date +%Y-%m-%d)
    SESSION_COUNT=0

    for dev_dir in "$FLOWFORGE_ROOT/developers/"*/; do
        if [[ -d "$dev_dir/sessions/history" ]]; then
            TODAY_SESSIONS=$(find "$dev_dir/sessions/history" -name "*.json" -newermt "$TODAY" 2>/dev/null | wc -l)
            SESSION_COUNT=$((SESSION_COUNT + TODAY_SESSIONS))
        fi
    done

    echo "📊 Sessions today: $SESSION_COUNT"
    echo ""
fi

echo "✅ Report generation complete"
```

## 📋 Exit
```bash
exit 0
```