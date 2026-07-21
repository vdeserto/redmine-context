#!/usr/bin/env python3
"""
Performance Tests for FlowForge Statusline Module
TDD: Test-Driven Development for <50ms execution requirement
"""

import json
import os
import sys
import time
import tempfile
import unittest
from datetime import datetime, timedelta
from pathlib import Path
from unittest.mock import patch, MagicMock, mock_open
import subprocess

# Add module to path
sys.path.insert(0, str(Path(__file__).parent))
import statusline_optimized as statusline


class TestStatuslinePerformance(unittest.TestCase):
    """Test suite for statusline performance optimization."""
    
    def setUp(self):
        """Set up test environment."""
        self.temp_dir = tempfile.mkdtemp()
        self.original_cwd = os.getcwd()
        os.chdir(self.temp_dir)
        
        # Create test files
        Path('.flowforge').mkdir(exist_ok=True)
        Path('.flowforge/RULES.md').touch()
        Path('.flowforge/tasks.json').write_text('{}')
        Path('CLAUDE.md').touch()
        
    def tearDown(self):
        """Clean up test environment."""
        os.chdir(self.original_cwd)
        import shutil
        shutil.rmtree(self.temp_dir)
    
    def test_execution_time_under_50ms_with_cache(self):
        """Test that statusline returns in <50ms when cache is available."""
        # Create cache file
        cache_data = {
            'timestamp': datetime.now().isoformat(),
            'data': {
                'issue_num': '123',
                'milestone_name': 'v2.0 Launch',
                'tasks_completed': 5,
                'tasks_total': 10,
                'time_remaining': '2h30m'
            }
        }
        Path('.flowforge/.statusline-cache.json').write_text(json.dumps(cache_data))
        
        with patch('subprocess.run') as mock_run:
            mock_run.return_value = MagicMock(returncode=0, stdout='feature/123-test')
            
            start_time = time.perf_counter()
            statusline.main()
            end_time = time.perf_counter()
            
            execution_time_ms = (end_time - start_time) * 1000
            self.assertLess(execution_time_ms, 50, 
                          f"Execution took {execution_time_ms:.2f}ms, should be <50ms")
    
    def test_execution_time_under_50ms_without_cache(self):
        """Test that statusline returns in <50ms even without cache (fast mode)."""
        os.environ['FLOWFORGE_FAST_MODE'] = '1'
        
        with patch('subprocess.run') as mock_run:
            mock_run.return_value = MagicMock(returncode=0, stdout='feature/123-test')
            
            start_time = time.perf_counter()
            statusline.main()
            end_time = time.perf_counter()
            
            execution_time_ms = (end_time - start_time) * 1000
            self.assertLess(execution_time_ms, 50,
                          f"Execution took {execution_time_ms:.2f}ms, should be <50ms")
    
    def test_background_refresh_spawned(self):
        """Test that background refresh is spawned when cache is stale."""
        # Create stale cache (6 minutes old)
        old_time = datetime.now() - timedelta(minutes=6)
        cache_data = {
            'timestamp': old_time.isoformat(),
            'data': {
                'issue_num': '123',
                'milestone_name': 'Old Data',
                'tasks_completed': 1,
                'tasks_total': 5,
                'time_remaining': '1h'
            }
        }
        Path('.flowforge/.statusline-cache.json').write_text(json.dumps(cache_data))
        
        with patch('subprocess.run') as mock_run, \
             patch('threading.Thread') as mock_thread:
            mock_run.return_value = MagicMock(returncode=0, stdout='feature/123-test')
            
            statusline.main()
            
            # Verify background refresh thread was started
            mock_thread.assert_called()
            mock_thread.return_value.start.assert_called()
    
    def test_cache_always_used_first(self):
        """Test that cache is always used first if available."""
        # Create recent cache
        cache_data = {
            'timestamp': datetime.now().isoformat(),
            'data': {
                'issue_num': '123',
                'milestone_name': 'Cached Data',
                'tasks_completed': 7,
                'tasks_total': 10,
                'time_remaining': '45m'
            }
        }
        Path('.flowforge/.statusline-cache.json').write_text(json.dumps(cache_data))
        
        with patch('subprocess.run') as mock_run:
            mock_run.side_effect = [
                MagicMock(returncode=0, stdout='feature/123-test'),  # git branch
                Exception("Should not call GitHub")  # Should not reach here
            ]
            
            output = statusline.get_cached_or_default('123')
            
            self.assertEqual(output['milestone_name'], 'Cached Data')
            self.assertEqual(output['tasks_completed'], 7)
    
    def test_regex_patterns_compiled_once(self):
        """Test that regex patterns are compiled at module level."""
        # Verify patterns are compiled
        self.assertIsNotNone(statusline.TASK_TOTAL_PATTERN)
        self.assertIsNotNone(statusline.TASK_COMPLETED_PATTERN)
        self.assertIsNotNone(statusline.TIME_PATTERN)
        self.assertIsNotNone(statusline.ISSUE_PATTERN)
        
        # Verify they're compiled regex objects
        import re
        self.assertIsInstance(statusline.TASK_TOTAL_PATTERN, type(re.compile('')))
    
    def test_single_pass_task_counting(self):
        """Test that task counting uses single-pass regex."""
        body = """
        - [x] Task 1 [1h]
        - [ ] Task 2 [2h]
        - [x] Task 3 [0.5h]
        - [ ] Task 4 [1.5h]
        - [x] Task 5 [1h]
        """
        
        start_time = time.perf_counter()
        stats = statusline.count_tasks_single_pass(body)
        end_time = time.perf_counter()
        
        self.assertEqual(stats['total'], 5)
        self.assertEqual(stats['completed'], 3)
        self.assertEqual(stats['remaining_hours'], 3.5)
        
        # Should be very fast
        execution_time_ms = (end_time - start_time) * 1000
        self.assertLess(execution_time_ms, 1, "Task counting should be <1ms")
    
    def test_fast_mode_default_behavior(self):
        """Test that fast mode is the default behavior."""
        # Don't set FLOWFORGE_FAST_MODE, should still be fast
        with patch('subprocess.run') as mock_run:
            mock_run.side_effect = [
                MagicMock(returncode=0, stdout='feature/123-test'),  # git branch
                subprocess.TimeoutExpired('gh', 0.05)  # GitHub timeout
            ]
            
            start_time = time.perf_counter()
            statusline.main()
            end_time = time.perf_counter()
            
            execution_time_ms = (end_time - start_time) * 1000
            self.assertLess(execution_time_ms, 50,
                          f"Should timeout quickly: {execution_time_ms:.2f}ms")
    
    def test_github_calls_never_block(self):
        """Test that GitHub API calls never block main execution."""
        with patch('subprocess.run') as mock_run:
            # Simulate slow GitHub API
            def slow_github(*args, **kwargs):
                if 'gh' in args[0]:
                    time.sleep(2)  # Simulate 2 second delay
                    return MagicMock(returncode=0, stdout='Slow Data')
                return MagicMock(returncode=0, stdout='feature/123-test')
            
            mock_run.side_effect = slow_github
            
            start_time = time.perf_counter()
            statusline.main()
            end_time = time.perf_counter()
            
            execution_time_ms = (end_time - start_time) * 1000
            self.assertLess(execution_time_ms, 50,
                          f"Should not wait for slow GitHub: {execution_time_ms:.2f}ms")
    
    def test_performance_monitoring_decorator(self):
        """Test that performance monitoring captures execution times."""
        @statusline.measure_performance('test_function')
        def slow_function():
            time.sleep(0.01)
            return "result"
        
        with patch.object(statusline, 'log_performance') as mock_log:
            result = slow_function()
            
            self.assertEqual(result, "result")
            mock_log.assert_called_once()
            
            # Verify timing was captured
            call_args = mock_log.call_args[0]
            self.assertEqual(call_args[0], 'test_function')
            self.assertGreaterEqual(call_args[1], 10)  # At least 10ms
    
    def test_cache_refresh_logic(self):
        """Test should_refresh_cache logic."""
        # Fresh cache - should not refresh
        fresh_time = datetime.now() - timedelta(seconds=30)
        self.assertFalse(statusline.should_refresh_cache(fresh_time.isoformat()))
        
        # Stale cache - should refresh
        stale_time = datetime.now() - timedelta(minutes=6)
        self.assertTrue(statusline.should_refresh_cache(stale_time.isoformat()))
        
        # Very old cache - should definitely refresh
        old_time = datetime.now() - timedelta(hours=2)
        self.assertTrue(statusline.should_refresh_cache(old_time.isoformat()))
    
    def test_end_to_end_performance_benchmark(self):
        """Comprehensive end-to-end performance benchmark."""
        scenarios = [
            ('with_cache', True, False),
            ('no_cache_fast_mode', False, True),
            ('no_cache_no_fast_mode', False, False)
        ]
        
        results = {}
        
        for name, has_cache, fast_mode in scenarios:
            # Setup scenario
            if has_cache:
                cache_data = {
                    'timestamp': datetime.now().isoformat(),
                    'data': {
                        'issue_num': '123',
                        'milestone_name': 'Test',
                        'tasks_completed': 5,
                        'tasks_total': 10,
                        'time_remaining': '2h'
                    }
                }
                Path('.flowforge/.statusline-cache.json').write_text(json.dumps(cache_data))
            else:
                cache_file = Path('.flowforge/.statusline-cache.json')
                if cache_file.exists():
                    cache_file.unlink()
            
            if fast_mode:
                os.environ['FLOWFORGE_FAST_MODE'] = '1'
            else:
                os.environ.pop('FLOWFORGE_FAST_MODE', None)
            
            # Measure performance
            with patch('subprocess.run') as mock_run:
                mock_run.return_value = MagicMock(returncode=0, stdout='feature/123-test')
                
                times = []
                for _ in range(10):
                    start = time.perf_counter()
                    statusline.main()
                    end = time.perf_counter()
                    times.append((end - start) * 1000)
                
                avg_time = sum(times) / len(times)
                max_time = max(times)
                
                results[name] = {
                    'avg_ms': avg_time,
                    'max_ms': max_time
                }
                
                # Assert all runs were under 50ms
                self.assertLess(max_time, 50,
                              f"{name}: Max time {max_time:.2f}ms exceeds 50ms limit")
        
        # Print benchmark results
        print("\n\nPerformance Benchmark Results:")
        print("-" * 50)
        for name, metrics in results.items():
            print(f"{name:25} Avg: {metrics['avg_ms']:6.2f}ms  Max: {metrics['max_ms']:6.2f}ms")


class TestOptimizationStrategies(unittest.TestCase):
    """Test specific optimization strategies."""
    
    def test_async_github_fetcher(self):
        """Test async GitHub data fetcher."""
        fetcher = statusline.AsyncGitHubFetcher('123')
        
        with patch('subprocess.run') as mock_run:
            mock_run.return_value = MagicMock(
                returncode=0,
                stdout='{"milestone": {"title": "v2.0"}}'
            )
            
            fetcher.start()
            time.sleep(0.1)  # Let thread run
            
            result = fetcher.get_result(timeout=0.01)
            self.assertIsNotNone(result)
    
    def test_thread_pool_executor(self):
        """Test thread pool for parallel operations."""
        from concurrent.futures import ThreadPoolExecutor
        
        def fetch_data(item):
            time.sleep(0.01)
            return item * 2
        
        items = list(range(10))
        
        # Sequential execution
        start = time.perf_counter()
        sequential_results = [fetch_data(i) for i in items]
        sequential_time = time.perf_counter() - start
        
        # Parallel execution
        start = time.perf_counter()
        with ThreadPoolExecutor(max_workers=4) as executor:
            parallel_results = list(executor.map(fetch_data, items))
        parallel_time = time.perf_counter() - start
        
        self.assertEqual(sequential_results, parallel_results)
        self.assertLess(parallel_time, sequential_time / 2,
                       "Parallel should be at least 2x faster")
    
    def test_lazy_evaluation(self):
        """Test lazy evaluation pattern."""
        class LazyProperty:
            def __init__(self, func):
                self.func = func
                self.value = None
            
            def __get__(self, obj, type=None):
                if self.value is None:
                    self.value = self.func(obj)
                return self.value
        
        class TestClass:
            @LazyProperty
            def expensive_property(self):
                time.sleep(0.01)
                return "computed"
        
        obj = TestClass()
        
        # First access - computes
        start = time.perf_counter()
        first = obj.expensive_property
        first_time = time.perf_counter() - start
        
        # Second access - cached
        start = time.perf_counter()
        second = obj.expensive_property
        second_time = time.perf_counter() - start
        
        self.assertEqual(first, second)
        self.assertLess(second_time, first_time / 10,
                       "Cached access should be much faster")


if __name__ == '__main__':
    # Run with verbose output
    unittest.main(verbosity=2)