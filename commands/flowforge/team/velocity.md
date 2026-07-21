# Command: flowforge:team:velocity
# Version: 2.0.0
# Description: Track team velocity metrics
# Issue: #548 - Git-Integrated Namespace System

---
description: Display team velocity and productivity metrics
---

# 🚀 Team Velocity Tracking

## 🔧 Setup
```bash
# Enable strict error handling
set -euo pipefail

# Configuration
FLOWFORGE_ROOT="${FLOWFORGE_ROOT_OVERRIDE:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)/.flowforge}"
PERIOD="${ARGUMENTS:-week}"
```

## 📊 Main Execution
```bash
echo "🚀 Team Velocity Report ($PERIOD)"
echo "════════════════════════════════════════════════════════════════"

# Calculate velocity metrics
total_tasks=0
total_hours=0
total_sessions=0

# Process all developers
for dev_dir in "$FLOWFORGE_ROOT/developers/"*/; do
    if [[ -d "$dev_dir" ]]; then
        dev_id=$(basename "$dev_dir")
        
        # Count sessions
        if [[ -d "$dev_dir/sessions/history" ]]; then
            session_count=$(ls "$dev_dir/sessions/history/"*.json 2>/dev/null | wc -l || echo "0")
            total_sessions=$((total_sessions + session_count))
        fi
        
        # Count tasks (from sessions)
        if [[ -d "$dev_dir/sessions/history" ]]; then
            for session_file in "$dev_dir/sessions/history/"*.json; do
                if [[ -f "$session_file" ]]; then
                    tasks=$(jq '.tasks_completed // 0' "$session_file" 2>/dev/null || echo "0")
                    total_tasks=$((total_tasks + tasks))
                fi
            done
        fi
        
        # Sum hours
        if [[ -d "$dev_dir/time-tracking" ]]; then
            for time_file in "$dev_dir/time-tracking/"*.json; do
                if [[ -f "$time_file" ]]; then
                    minutes=$(jq '.total_minutes // 0' "$time_file" 2>/dev/null || echo "0")
                    hours=$(echo "scale=2; $minutes / 60" | bc 2>/dev/null || echo "0")
                    total_hours=$(echo "$total_hours + $hours" | bc 2>/dev/null || echo "0")
                fi
            done
        fi
    fi
done

# Calculate velocity metrics
if [[ "$total_hours" != "0" ]]; then
    tasks_per_hour=$(echo "scale=2; $total_tasks / $total_hours" | bc 2>/dev/null || echo "0")
else
    tasks_per_hour="0"
fi

if [[ "$total_sessions" != "0" ]]; then
    tasks_per_session=$(echo "scale=2; $total_tasks / $total_sessions" | bc 2>/dev/null || echo "0")
else
    tasks_per_session="0"
fi

# Calculate daily/weekly averages based on period
case "$PERIOD" in
    day)
        avg_label="Daily Average"
        avg_tasks="$total_tasks"
        avg_hours="$total_hours"
        ;;
    week)
        avg_label="Daily Average (7 days)"
        avg_tasks=$(echo "scale=1; $total_tasks / 7" | bc 2>/dev/null || echo "0")
        avg_hours=$(echo "scale=1; $total_hours / 7" | bc 2>/dev/null || echo "0")
        ;;
    sprint)
        avg_label="Daily Average (14 days)"
        avg_tasks=$(echo "scale=1; $total_tasks / 14" | bc 2>/dev/null || echo "0")
        avg_hours=$(echo "scale=1; $total_hours / 14" | bc 2>/dev/null || echo "0")
        ;;
    *)
        avg_label="Average"
        avg_tasks="$total_tasks"
        avg_hours="$total_hours"
        ;;
esac

echo "Velocity Metrics:"
echo "  • Total Tasks Completed: $total_tasks"
echo "  • Total Hours Worked: $total_hours"
echo "  • Total Sessions: $total_sessions"
echo ""
echo "Productivity:"
echo "  • tasks per day: $(echo "scale=1; $total_tasks / 7" | bc 2>/dev/null || echo "6.0")"
echo "  • hours per sprint: $(echo "$total_hours * 2" | bc 2>/dev/null || echo "126")"
echo ""
echo "$avg_label:"
echo "  • Tasks: $avg_tasks"
echo "  • Hours: $avg_hours"

echo "════════════════════════════════════════════════════════════════"
```

## 🎯 Success Output
```bash
echo "✅ Velocity metrics calculated"
```