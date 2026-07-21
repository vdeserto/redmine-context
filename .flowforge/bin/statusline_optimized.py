#!/usr/bin/env python3
"""
FlowForge Statusline Core Module - Optimized Version
Provides project-aware statusline for Claude Code
Performance Target: <50ms execution time
"""

import json
import os
import re
import subprocess
import sys
import threading
import time
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, Optional, Tuple, Any
from functools import wraps
from concurrent.futures import ThreadPoolExecutor

# ============================================================================
# PERFORMANCE OPTIMIZATION: Compile all regex patterns at module level
# ============================================================================
ISSUE_PATTERN = re.compile(r'(\d+)')
TASK_TOTAL_PATTERN = re.compile(r'^-\s*\[[ x]\]', re.MULTILINE)
TASK_COMPLETED_PATTERN = re.compile(r'^-\s*\[x\]', re.MULTILINE)
TIME_PATTERN = re.compile(r'^-\s*\[ \].*\[(\d+(?:\.\d+)?)h\]', re.MULTILINE)

# ============================================================================
# PERFORMANCE OPTIMIZATION: Module-level cache for frequently accessed data
# ============================================================================
_PROJECT_CACHE = {}
_PERFORMANCE_METRICS = {}

# Default to fast mode for <50ms guarantee
FAST_MODE_DEFAULT = True

# Cache refresh interval (60 seconds for better freshness)
CACHE_REFRESH_INTERVAL = 60

# Performance targets
CACHE_HIT_TARGET_MS = 10
FIRST_RUN_MAX_MS = 500


def measure_performance(name: str):
    """Decorator to measure function execution time."""
    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            start = time.perf_counter()
            try:
                result = func(*args, **kwargs)
                return result
            finally:
                end = time.perf_counter()
                duration_ms = (end - start) * 1000
                log_performance(name, duration_ms)
        return wrapper
    return decorator


def log_performance(name: str, duration_ms: float):
    """Log performance metrics (in production, send to monitoring)."""
    _PERFORMANCE_METRICS[name] = duration_ms
    if duration_ms > 10:  # Log slow operations
        # In production, this would send to monitoring service
        pass


class AsyncGitHubFetcher:
    """Asynchronous GitHub data fetcher that never blocks main execution."""
    
    def __init__(self, issue_num: str):
        self.issue_num = issue_num
        self.result = None
        self.thread = None
        self.completed = False
    
    def start(self):
        """Start background fetch."""
        self.thread = threading.Thread(target=self._fetch, daemon=True)
        self.thread.start()
    
    def _fetch(self):
        """Fetch data in background thread."""
        try:
            data = self._fetch_github_data()
            self.result = data
            self.completed = True
            # Save to cache for next run
            save_statusline_cache(data, self.issue_num)
        except Exception:
            self.completed = True
    
    def _fetch_github_data(self) -> Dict:
        """Actual GitHub API calls."""
        data = {
            'issue_num': self.issue_num,
            'milestone_name': '',
            'tasks_completed': 0,
            'tasks_total': 0,
            'time_remaining': '0m'
        }
        
        try:
            # Get milestone name
            result = subprocess.run(
                ['gh', 'issue', 'view', self.issue_num, '--json', 'milestone', '-q', '.milestone.title // ""'],
                capture_output=True,
                text=True,
                timeout=5
            )
            if result.returncode == 0:
                data['milestone_name'] = result.stdout.strip()
            
            # Get issue body
            result = subprocess.run(
                ['gh', 'issue', 'view', self.issue_num, '--json', 'body', '-q', '.body // ""'],
                capture_output=True,
                text=True,
                timeout=5
            )
            
            if result.returncode == 0 and result.stdout:
                stats = count_tasks_single_pass(result.stdout)
                data['tasks_total'] = stats['total']
                data['tasks_completed'] = stats['completed']
                
                # Format remaining time
                hours = stats['remaining_hours']
                if hours > 0:
                    if hours >= 1:
                        h = int(hours)
                        m = int((hours - h) * 60)
                        data['time_remaining'] = f"{h}h{m}m" if m > 0 else f"{h}h"
                    else:
                        data['time_remaining'] = f"{int(hours * 60)}m"
        
        except (subprocess.SubprocessError, Exception):
            pass
        
        return data
    
    def get_result(self, timeout: float = 1.0) -> Optional[Dict]:
        """Get result if available within timeout."""
        if self.completed:
            return self.result
        
        if self.thread and self.thread.is_alive():
            self.thread.join(timeout=timeout)
        
        return self.result if self.completed else None


def count_tasks_single_pass(body: str) -> Dict[str, Any]:
    """Count tasks in a single regex pass for performance."""
    stats = {
        'total': 0,
        'completed': 0,
        'remaining_hours': 0.0
    }
    
    # Single pass with finditer for efficiency
    for line in body.split('\n'):
        if line.strip().startswith('-'):
            if '[ ]' in line or '[x]' in line:
                stats['total'] += 1
                if '[x]' in line:
                    stats['completed'] += 1
                elif '[ ]' in line:
                    # Extract time if present
                    time_match = re.search(r'\[(\d+(?:\.\d+)?)h\]', line)
                    if time_match:
                        stats['remaining_hours'] += float(time_match.group(1))
    
    return stats


@measure_performance('is_flowforge_project')
def is_flowforge_project() -> bool:
    """Check if current directory is a FlowForge project (cached)."""
    if 'is_flowforge' in _PROJECT_CACHE:
        return _PROJECT_CACHE['is_flowforge']
    
    markers = [
        '.flowforge/RULES.md',
        '.flowforge/tasks.json',
        'CLAUDE.md',
        '.flowforge'
    ]
    
    for marker in markers:
        if Path(marker).exists():
            _PROJECT_CACHE['is_flowforge'] = True
            return True
    
    _PROJECT_CACHE['is_flowforge'] = False
    return False


@measure_performance('read_stdin')
def read_stdin_json() -> Dict:
    """Read JSON input from stdin (from Claude Code)."""
    try:
        if sys.stdin.isatty():
            return {}
        input_data = sys.stdin.read()
        return json.loads(input_data) if input_data else {}
    except (json.JSONDecodeError, Exception):
        return {}


@measure_performance('get_git_branch')
def get_git_branch() -> str:
    """Get current git branch name (with timeout)."""
    if 'git_branch' in _PROJECT_CACHE:
        return _PROJECT_CACHE['git_branch']
    
    try:
        result = subprocess.run(
            ['git', 'branch', '--show-current'],
            capture_output=True,
            text=True,
            timeout=0.05  # 50ms timeout
        )
        if result.returncode == 0:
            branch = result.stdout.strip() or "no-branch"
            _PROJECT_CACHE['git_branch'] = branch
            return branch
    except (subprocess.SubprocessError, FileNotFoundError, subprocess.TimeoutExpired):
        pass
    
    return "no-branch"


def extract_issue_number(branch: str) -> Optional[str]:
    """Extract issue number from branch name (using pre-compiled regex)."""
    match = ISSUE_PATTERN.search(branch)
    return match.group(1) if match else None


def should_refresh_cache(cache: Dict) -> bool:
    """Determine if cache should be refreshed based on TTL."""
    try:
        timestamp_str = cache.get('timestamp')
        ttl = cache.get('ttl', CACHE_REFRESH_INTERVAL)
        if not timestamp_str:
            return True
        cache_time = datetime.fromisoformat(timestamp_str)
        age_seconds = (datetime.now() - cache_time).total_seconds()
        return age_seconds > ttl
    except:
        return True


@measure_performance('load_cache')
def load_statusline_cache() -> Dict:
    """Load cached statusline data with performance optimization."""
    try:
        cache_file = Path('.flowforge/.statusline-cache.json')
        if cache_file.exists():
            # Check file size first (should be small)
            if cache_file.stat().st_size > 10000:  # 10KB max
                return {}
            with open(cache_file, 'r') as f:
                cache = json.load(f)
                # Validate cache structure
                if 'timestamp' in cache and 'data' in cache:
                    return cache
    except (json.JSONDecodeError, OSError, Exception):
        pass
    return {}


def save_statusline_cache(data: Dict, issue_num: str = None):
    """Save statusline data to cache atomically (fire and forget)."""
    def _save():
        try:
            cache_dir = Path('.flowforge')
            cache_dir.mkdir(exist_ok=True)
            cache_file = cache_dir / '.statusline-cache.json'
            temp_file = cache_dir / '.statusline-cache.tmp'

            # Include issue number and title if available
            cache_data = {
                'timestamp': datetime.now().isoformat(),
                'ttl': CACHE_REFRESH_INTERVAL,
                'issue_number': issue_num or data.get('issue_num', ''),
                'data': data
            }

            # Get issue title from GitHub if we have issue number
            if issue_num and 'title' not in data:
                try:
                    result = subprocess.run(
                        ['gh', 'issue', 'view', issue_num, '--json', 'title', '-q', '.title'],
                        capture_output=True,
                        text=True,
                        timeout=2
                    )
                    if result.returncode == 0:
                        cache_data['data']['title'] = result.stdout.strip()
                except:
                    pass

            # Write to temp file first (atomic operation)
            with open(temp_file, 'w') as f:
                json.dump(cache_data, f, indent=2)

            # Atomic rename
            temp_file.replace(cache_file)
        except Exception:
            # Clean up temp file if it exists
            try:
                temp_file.unlink()
            except:
                pass

    # Save in background thread to not block
    thread = threading.Thread(target=_save, daemon=True)
    thread.start()


def get_cached_or_default(issue_num: str) -> Tuple[Dict, bool]:
    """Get cached data or return defaults immediately.
    Returns: (data, is_from_cache)
    """
    default_data = {
        'issue_num': issue_num,
        'milestone_name': '',
        'tasks_completed': 0,
        'tasks_total': 0,
        'time_remaining': '0m'
    }

    cache = load_statusline_cache()
    if cache:
        cache_data = cache.get('data', {})
        # Check if cache is for the same issue
        cache_issue = cache.get('issue_number', '')
        if cache_issue == issue_num:
            # Check if we should refresh in background
            if should_refresh_cache(cache):
                # Spawn truly detached background refresh using subprocess
                spawn_background_refresh(issue_num)
            return cache_data, True

    return default_data, False


def spawn_background_refresh(issue_num: str):
    """Spawn a truly detached background process to refresh cache."""
    try:
        # Use subprocess to spawn a detached process that won't block
        import platform
        if platform.system() != 'Windows':
            # Unix-like systems: use nohup or detached process
            subprocess.Popen(
                [sys.executable, __file__, '--refresh-cache', issue_num],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                stdin=subprocess.DEVNULL,
                start_new_session=True
            )
        else:
            # Windows: use CREATE_NO_WINDOW flag
            subprocess.Popen(
                [sys.executable, __file__, '--refresh-cache', issue_num],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                stdin=subprocess.DEVNULL,
                creationflags=subprocess.CREATE_NO_WINDOW if hasattr(subprocess, 'CREATE_NO_WINDOW') else 0
            )
    except:
        # Fallback to thread-based refresh if subprocess fails
        fetcher = AsyncGitHubFetcher(issue_num)
        fetcher.start()


@measure_performance('is_timer_active')
def is_timer_active(issue_num: str) -> bool:
    """Check if timer is active for the given issue."""
    try:
        task_file = Path('.task-times.json')
        if task_file.exists():
            with open(task_file, 'r') as f:
                tasks = json.load(f)
                task_data = tasks.get(issue_num, {})
                return task_data.get('status') == 'active'
    except (json.JSONDecodeError, Exception):
        pass
    return False


def get_project_name() -> str:
    """Get project name from package.json or directory name (cached)."""
    if 'project_name' in _PROJECT_CACHE:
        return _PROJECT_CACHE['project_name']
    
    try:
        package_file = Path('package.json')
        if package_file.exists():
            with open(package_file, 'r') as f:
                package = json.load(f)
                name = package.get('name', '')
                if name:
                    _PROJECT_CACHE['project_name'] = name
                    return name
    except (json.JSONDecodeError, Exception):
        pass
    
    name = Path.cwd().name
    _PROJECT_CACHE['project_name'] = name
    return name


def load_milestone_data() -> Dict:
    """Load milestone data from local JSON file."""
    try:
        milestone_file = Path('.flowforge/milestones.json')
        if milestone_file.exists():
            with open(milestone_file, 'r') as f:
                data = json.load(f)
                return data.get('current', {})
    except (json.JSONDecodeError, Exception):
        pass
    return {}


def format_statusline(
    is_flowforge: bool,
    milestone_name: str,
    tasks_completed: int,
    tasks_total: int,
    time_remaining: str,
    branch: str,
    model: str,
    timer_active: bool
) -> str:
    """Format the complete statusline."""
    if is_flowforge:
        # FlowForge project format
        status = f"[FlowForge] {milestone_name}({tasks_completed}/{tasks_total}):{time_remaining}"
        status += f" | Branch: {branch}"
        status += f" | {model}"
        if timer_active:
            status += " | ● Active"
    else:
        # Non-FlowForge project format
        status = f"{milestone_name} | Branch: {branch} | {model}"
    
    return status


@measure_performance('main')
def main():
    """Main entry point for statusline generation - optimized for <50ms."""
    # Read input from Claude Code
    input_data = read_stdin_json()
    model = input_data.get('model', {}).get('display_name', 'Claude')
    
    # Check if FlowForge project (cached)
    is_ff = is_flowforge_project()
    
    # Get git branch (with timeout)
    branch = get_git_branch()
    issue_num = extract_issue_number(branch) if is_ff else None
    
    # Initialize default values
    milestone_name = ""
    tasks_completed = 0
    tasks_total = 0
    time_remaining = "0m"
    timer_active = False
    
    if is_ff and issue_num:
        # PERFORMANCE OPTIMIZATION: Always use cache first, refresh in background
        fast_mode = os.environ.get('FLOWFORGE_FAST_MODE', str(FAST_MODE_DEFAULT))

        if fast_mode not in ['0', 'false', 'False']:
            # Fast mode: Use cache or defaults, never wait for GitHub
            gh_data, from_cache = get_cached_or_default(issue_num)

            # If no cache exists, do ONE sync fetch on first run
            if not from_cache:
                fetcher = AsyncGitHubFetcher(issue_num)
                fetcher.start()
                # First run only: accept up to 500ms wait
                gh_data = fetcher.get_result(timeout=0.5)
                if not gh_data:
                    gh_data, _ = get_cached_or_default(issue_num)
        else:
            # Non-fast mode: Still prioritize cache but allow longer timeout
            gh_data, from_cache = get_cached_or_default(issue_num)

            if not from_cache:
                # No cache, try fetch with 1 second timeout
                fetcher = AsyncGitHubFetcher(issue_num)
                fetcher.start()
                gh_data = fetcher.get_result(timeout=1.0)
                if not gh_data:
                    gh_data, _ = get_cached_or_default(issue_num)
        
        milestone_name = gh_data['milestone_name']
        tasks_completed = gh_data['tasks_completed']
        tasks_total = gh_data['tasks_total']
        time_remaining = gh_data['time_remaining']
        
        # Check timer status (fast local file check)
        timer_active = is_timer_active(issue_num)
    
    # If no milestone from GitHub, try local files
    if is_ff and not milestone_name:
        milestone_data = load_milestone_data()
        if milestone_data:
            milestone_name = milestone_data.get('name', '')
            tasks_completed = milestone_data.get('completed', 0)
            tasks_total = milestone_data.get('total', 0)
            time_remaining = milestone_data.get('timeRemaining', '0m')
    
    # Fallback to project name
    if not milestone_name:
        milestone_name = get_project_name()
    
    # Format and output statusline
    statusline = format_statusline(
        is_ff,
        milestone_name,
        tasks_completed,
        tasks_total,
        time_remaining,
        branch,
        model,
        timer_active
    )
    
    print(statusline, end='')
    
    # Log performance metrics if in debug mode
    if os.environ.get('FLOWFORGE_DEBUG'):
        total_time = sum(_PERFORMANCE_METRICS.values())
        if total_time > 50:
            sys.stderr.write(f"WARNING: Statusline took {total_time:.2f}ms\n")
            for name, duration in _PERFORMANCE_METRICS.items():
                if duration > 5:
                    sys.stderr.write(f"  {name}: {duration:.2f}ms\n")


def refresh_cache_mode():
    """Special mode for background cache refresh."""
    if len(sys.argv) >= 3 and sys.argv[1] == '--refresh-cache':
        issue_num = sys.argv[2]
        fetcher = AsyncGitHubFetcher(issue_num)
        fetcher._fetch()  # Direct fetch, no threading needed
        sys.exit(0)
    return False


if __name__ == '__main__':
    # Check if we're in cache refresh mode
    if not refresh_cache_mode():
        main()