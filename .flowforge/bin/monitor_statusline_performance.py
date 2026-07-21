#!/usr/bin/env python3
"""
Performance Monitor for FlowForge Statusline
Continuously monitors and reports statusline execution time
"""

import json
import os
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import List, Dict


class StatuslinePerformanceMonitor:
    """Monitor statusline performance metrics."""
    
    def __init__(self):
        self.metrics: List[Dict] = []
        self.max_samples = 100
        self.warning_threshold_ms = 50
        self.critical_threshold_ms = 100
    
    def measure_execution(self) -> float:
        """Measure single statusline execution."""
        input_data = json.dumps({"model": {"display_name": "Claude"}})
        
        start = time.perf_counter()
        try:
            result = subprocess.run(
                [sys.executable, '.flowforge/bin/statusline'],
                input=input_data,
                capture_output=True,
                text=True,
                timeout=1
            )
            end = time.perf_counter()
            
            duration_ms = (end - start) * 1000
            
            return duration_ms
        except subprocess.TimeoutExpired:
            return 1000  # Timeout = 1000ms
        except Exception as e:
            print(f"Error measuring: {e}")
            return -1
    
    def analyze_metrics(self) -> Dict:
        """Analyze collected metrics."""
        if not self.metrics:
            return {}
        
        durations = [m['duration_ms'] for m in self.metrics]
        
        return {
            'count': len(durations),
            'avg_ms': sum(durations) / len(durations),
            'min_ms': min(durations),
            'max_ms': max(durations),
            'p50_ms': self.percentile(durations, 50),
            'p95_ms': self.percentile(durations, 95),
            'p99_ms': self.percentile(durations, 99),
            'violations': sum(1 for d in durations if d > self.warning_threshold_ms),
            'critical': sum(1 for d in durations if d > self.critical_threshold_ms)
        }
    
    def percentile(self, data: List[float], p: float) -> float:
        """Calculate percentile."""
        sorted_data = sorted(data)
        index = int(len(sorted_data) * p / 100)
        return sorted_data[min(index, len(sorted_data) - 1)]
    
    def print_report(self, analysis: Dict):
        """Print performance report."""
        print("\n" + "=" * 60)
        print("FLOWFORGE STATUSLINE PERFORMANCE REPORT")
        print("=" * 60)
        print(f"Timestamp: {datetime.now().isoformat()}")
        print(f"Samples: {analysis.get('count', 0)}")
        print("-" * 60)
        
        # Color codes
        GREEN = '\033[92m'
        YELLOW = '\033[93m'
        RED = '\033[91m'
        RESET = '\033[0m'
        
        def colorize(value: float, threshold: float, critical: float) -> str:
            if value < threshold:
                return f"{GREEN}{value:.2f}ms{RESET}"
            elif value < critical:
                return f"{YELLOW}{value:.2f}ms{RESET}"
            else:
                return f"{RED}{value:.2f}ms{RESET}"
        
        print(f"Average: {colorize(analysis.get('avg_ms', 0), 50, 100)}")
        print(f"Min: {colorize(analysis.get('min_ms', 0), 50, 100)}")
        print(f"Max: {colorize(analysis.get('max_ms', 0), 50, 100)}")
        print(f"P50: {colorize(analysis.get('p50_ms', 0), 50, 100)}")
        print(f"P95: {colorize(analysis.get('p95_ms', 0), 50, 100)}")
        print(f"P99: {colorize(analysis.get('p99_ms', 0), 50, 100)}")
        print("-" * 60)
        
        violations = analysis.get('violations', 0)
        critical = analysis.get('critical', 0)
        
        if violations == 0:
            print(f"{GREEN}✓ All executions under 50ms!{RESET}")
        else:
            print(f"{YELLOW}⚠ {violations} executions exceeded 50ms{RESET}")
        
        if critical > 0:
            print(f"{RED}✗ {critical} executions exceeded 100ms (CRITICAL){RESET}")
        
        print("=" * 60)
    
    def continuous_monitor(self, interval: float = 1.0, duration: int = 60):
        """Run continuous monitoring."""
        print(f"Starting continuous monitoring for {duration} seconds...")
        print(f"Sampling every {interval} seconds")
        print("Press Ctrl+C to stop early\n")
        
        start_time = time.time()
        
        try:
            while time.time() - start_time < duration:
                duration_ms = self.measure_execution()
                
                if duration_ms > 0:
                    self.metrics.append({
                        'timestamp': datetime.now().isoformat(),
                        'duration_ms': duration_ms
                    })
                    
                    # Keep only recent samples
                    if len(self.metrics) > self.max_samples:
                        self.metrics.pop(0)
                    
                    # Print inline status
                    status = "✓" if duration_ms < self.warning_threshold_ms else "⚠"
                    if duration_ms > self.critical_threshold_ms:
                        status = "✗"
                    
                    print(f"{status} {duration_ms:6.2f}ms", end="  ")
                    if len(self.metrics) % 10 == 0:
                        print()  # New line every 10 samples
                
                time.sleep(interval)
        
        except KeyboardInterrupt:
            print("\n\nMonitoring stopped by user")
        
        # Final report
        if self.metrics:
            analysis = self.analyze_metrics()
            self.print_report(analysis)
            
            # Save detailed metrics
            self.save_metrics()
    
    def save_metrics(self):
        """Save metrics to file for analysis."""
        output_file = Path('.flowforge/statusline-performance.json')
        output_file.parent.mkdir(exist_ok=True)
        
        with open(output_file, 'w') as f:
            json.dump({
                'timestamp': datetime.now().isoformat(),
                'analysis': self.analyze_metrics(),
                'raw_metrics': self.metrics
            }, f, indent=2)
        
        print(f"\nDetailed metrics saved to: {output_file}")
    
    def benchmark_mode(self, iterations: int = 100):
        """Run performance benchmark."""
        print(f"Running benchmark with {iterations} iterations...")
        
        # Warmup
        print("Warming up...", end=" ")
        for _ in range(10):
            self.measure_execution()
        print("done")
        
        # Actual benchmark
        print("Benchmarking...", end=" ")
        for i in range(iterations):
            if i % 10 == 0:
                print(f"{i}", end=" ")
            
            duration_ms = self.measure_execution()
            if duration_ms > 0:
                self.metrics.append({
                    'timestamp': datetime.now().isoformat(),
                    'duration_ms': duration_ms
                })
        
        print("done")
        
        # Report results
        analysis = self.analyze_metrics()
        self.print_report(analysis)
        self.save_metrics()


def main():
    """Main entry point."""
    import argparse
    
    parser = argparse.ArgumentParser(description='Monitor FlowForge statusline performance')
    parser.add_argument('--mode', choices=['continuous', 'benchmark', 'single'],
                       default='continuous', help='Monitoring mode')
    parser.add_argument('--duration', type=int, default=60,
                       help='Duration for continuous monitoring (seconds)')
    parser.add_argument('--interval', type=float, default=1.0,
                       help='Sampling interval (seconds)')
    parser.add_argument('--iterations', type=int, default=100,
                       help='Number of iterations for benchmark mode')
    
    args = parser.parse_args()
    
    monitor = StatuslinePerformanceMonitor()
    
    if args.mode == 'continuous':
        monitor.continuous_monitor(args.interval, args.duration)
    elif args.mode == 'benchmark':
        monitor.benchmark_mode(args.iterations)
    elif args.mode == 'single':
        duration_ms = monitor.measure_execution()
        if duration_ms < 50:
            print(f"✓ {duration_ms:.2f}ms (PASS)")
        else:
            print(f"✗ {duration_ms:.2f}ms (FAIL - exceeds 50ms)")
            sys.exit(1)


if __name__ == '__main__':
    main()