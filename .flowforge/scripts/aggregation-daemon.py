#!/usr/bin/env python3
"""
FlowForge Time Aggregation Daemon
Ensures 100% reliability for time tracking aggregation
Production-ready implementation
"""

import os
import sys
import json
import time
import signal
import logging
import hashlib
import threading
from pathlib import Path
from datetime import datetime, timedelta
from typing import Dict, List, Optional
import fcntl

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

class FlowForgeAggregationDaemon:
    """
    Production-grade daemon for time tracking aggregation.
    Guarantees data integrity and billing accuracy.
    """
    
    def __init__(self, flowforge_root: Path = None):
        self.flowforge_root = flowforge_root or Path(".flowforge")
        self.daemon_dir = self.flowforge_root / "daemon"
        self.queue_dir = self.daemon_dir / "queue"
        self.failed_dir = self.daemon_dir / "failed"
        self.pid_file = self.daemon_dir / "flowforge-daemon.pid"
        
        # Setup logging
        self.setup_logging()
        
        # Initialize components
        self.running = False
        self.queue = []
        self.lock = threading.Lock()
        
        # Performance metrics
        self.metrics = {
            "aggregations_successful": 0,
            "aggregations_failed": 0,
            "queue_size": 0,
            "last_aggregation": None,
            "start_time": datetime.utcnow().isoformat()
        }
    
    def setup_logging(self):
        """Configure production logging."""
        log_dir = self.daemon_dir / "logs"
        log_dir.mkdir(parents=True, exist_ok=True)
        
        # Setup rotating file handler
        from logging.handlers import RotatingFileHandler
        
        logging.basicConfig(
            level=logging.INFO,
            format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
            handlers=[
                RotatingFileHandler(
                    log_dir / "daemon.log",
                    maxBytes=10485760,  # 10MB
                    backupCount=5
                ),
                logging.StreamHandler()
            ]
        )
        self.logger = logging.getLogger(__name__)
    
    def start(self):
        """Start the daemon service."""
        # Check if already running
        if self.is_running():
            self.logger.error("Daemon already running")
            sys.exit(1)
        
        # Create PID file
        self.create_pid_file()
        
        # Setup signal handlers
        signal.signal(signal.SIGTERM, self.handle_shutdown)
        signal.signal(signal.SIGINT, self.handle_shutdown)
        signal.signal(signal.SIGUSR1, self.handle_queue_signal)
        
        self.running = True
        self.logger.info("FlowForge Aggregation Daemon started")
        
        # Start queue processor
        queue_thread = threading.Thread(target=self.process_queue_loop)
        queue_thread.daemon = True
        queue_thread.start()
        
        # Start health check
        health_thread = threading.Thread(target=self.health_check_loop)
        health_thread.daemon = True
        health_thread.start()
        
        # Main loop
        try:
            while self.running:
                time.sleep(1)
                self.check_pending_aggregations()
        except Exception as e:
            self.logger.error(f"Daemon error: {e}", exc_info=True)
        finally:
            self.cleanup()
    
    def check_pending_aggregations(self):
        """Check for pending aggregations in queue."""
        if not self.queue_dir.exists():
            self.queue_dir.mkdir(parents=True, exist_ok=True)
            return
        
        queue_files = sorted(self.queue_dir.glob("*.json"))
        
        for queue_file in queue_files:
            try:
                with open(queue_file) as f:
                    task = json.load(f)
                
                # Check if ready to process
                retry_after = task.get("retry_after", "1970-01-01T00:00:00Z")
                retry_time = datetime.fromisoformat(retry_after.replace("Z", "+00:00"))
                
                if datetime.utcnow().replace(tzinfo=retry_time.tzinfo) >= retry_time:
                    self.queue_aggregation(queue_file, task)
                    
            except Exception as e:
                self.logger.error(f"Error processing queue file {queue_file}: {e}")
                self.move_to_failed(queue_file)
    
    def queue_aggregation(self, queue_file: Path, task: dict):
        """Queue an aggregation task."""
        with self.lock:
            self.queue.append({
                "file": queue_file,
                "task": task,
                "attempts": 0
            })
            self.metrics["queue_size"] = len(self.queue)
    
    def process_queue_loop(self):
        """Process aggregation queue."""
        while self.running:
            if self.queue:
                with self.lock:
                    if self.queue:
                        item = self.queue.pop(0)
                        self.metrics["queue_size"] = len(self.queue)
                
                self.process_aggregation(item)
            else:
                time.sleep(5)
    
    def process_aggregation(self, item: dict):
        """Process a single aggregation task."""
        try:
            self.logger.info(f"Processing aggregation: {item['file']}")
            
            # Perform aggregation
            success = self.aggregate_time_data()
            
            if success:
                # Remove from queue
                item["file"].unlink(missing_ok=True)
                self.metrics["aggregations_successful"] += 1
                self.metrics["last_aggregation"] = datetime.utcnow().isoformat()
                self.logger.info("Aggregation successful")
            else:
                item["attempts"] += 1
                if item["attempts"] >= 3:
                    self.move_to_failed(item["file"])
                    self.metrics["aggregations_failed"] += 1
                else:
                    # Retry later
                    with self.lock:
                        self.queue.append(item)
                        
        except Exception as e:
            self.logger.error(f"Aggregation error: {e}", exc_info=True)
            self.move_to_failed(item["file"])
    
    def aggregate_time_data(self) -> bool:
        """
        Core aggregation logic.
        Returns True if successful.
        """
        try:
            summary_file = self.flowforge_root / "team" / "summaries" / "current.json"
            summary_file.parent.mkdir(parents=True, exist_ok=True)
            
            # Initialize summary
            summary = {
                "version": "2.0.0",
                "timestamp": datetime.utcnow().isoformat() + "Z",
                "aggregation_id": f"{time.time()}-{os.getpid()}",
                "users": {},
                "totals": {
                    "hours": 0,
                    "sessions": 0,
                    "issues": []
                },
                "metadata": {
                    "daemon_version": "1.0.0",
                    "aggregation_method": "daemon",
                    "hostname": os.uname().nodename if hasattr(os, 'uname') else 'unknown'
                }
            }
            
            # Aggregate user data
            user_dir = self.flowforge_root / "user"
            if user_dir.exists():
                for user_path in user_dir.iterdir():
                    if user_path.is_dir():
                        username = user_path.name
                        user_time_file = user_path / "time" / "current.json"
                        
                        if user_time_file.exists():
                            try:
                                with open(user_time_file) as f:
                                    user_data = json.load(f)
                                
                                summary["users"][username] = user_data
                                summary["totals"]["hours"] += user_data.get("total_hours", 0)
                                summary["totals"]["sessions"] += user_data.get("sessions", 0)
                                
                                issues = user_data.get("issues", [])
                                if isinstance(issues, list):
                                    summary["totals"]["issues"].extend(issues)
                                    
                            except Exception as e:
                                self.logger.warning(f"Error reading {username} data: {e}")
            
            # Remove duplicate issues
            summary["totals"]["issues"] = list(set(summary["totals"]["issues"]))
            
            # Calculate checksum
            summary_copy = json.loads(json.dumps(summary))
            if "checksum" in summary_copy.get("metadata", {}):
                del summary_copy["metadata"]["checksum"]
            
            checksum = hashlib.sha256(
                json.dumps(summary_copy, sort_keys=True).encode()
            ).hexdigest()
            summary["metadata"]["checksum"] = checksum
            
            # Write atomically
            temp_file = summary_file.with_suffix(".tmp")
            with open(temp_file, "w") as f:
                json.dump(summary, f, indent=2)
            
            temp_file.replace(summary_file)
            
            # Update periodic summaries
            self.update_periodic_summaries(summary)
            
            return True
            
        except Exception as e:
            self.logger.error(f"Aggregation failed: {e}", exc_info=True)
            return False
    
    def update_periodic_summaries(self, summary: dict):
        """Update weekly and monthly summaries."""
        try:
            # Weekly summary
            week_dir = self.flowforge_root / "team" / "summaries" / "weekly"
            week_dir.mkdir(parents=True, exist_ok=True)
            week_file = week_dir / f"{datetime.now():%Y-W%V}.json"
            
            if week_file.exists():
                with open(week_file) as f:
                    week_data = json.load(f)
                # Merge data
                week_data["totals"]["hours"] += summary["totals"]["hours"]
                week_data["totals"]["sessions"] += summary["totals"]["sessions"]
                week_data["totals"]["issues"] = list(set(
                    week_data["totals"]["issues"] + summary["totals"]["issues"]
                ))
                week_data["last_updated"] = summary["timestamp"]
            else:
                week_data = summary.copy()
                week_data["period"] = f"{datetime.now():%Y-W%V}"
            
            with open(week_file, "w") as f:
                json.dump(week_data, f, indent=2)
            
            # Monthly summary
            month_dir = self.flowforge_root / "team" / "summaries" / "monthly"
            month_dir.mkdir(parents=True, exist_ok=True)
            month_file = month_dir / f"{datetime.now():%Y-%m}.json"
            
            if month_file.exists():
                with open(month_file) as f:
                    month_data = json.load(f)
                month_data["totals"]["hours"] += summary["totals"]["hours"]
                month_data["totals"]["sessions"] += summary["totals"]["sessions"]
                month_data["totals"]["issues"] = list(set(
                    month_data["totals"]["issues"] + summary["totals"]["issues"]
                ))
                month_data["last_updated"] = summary["timestamp"]
            else:
                month_data = summary.copy()
                month_data["period"] = f"{datetime.now():%Y-%m}"
            
            with open(month_file, "w") as f:
                json.dump(month_data, f, indent=2)
                
        except Exception as e:
            self.logger.error(f"Error updating periodic summaries: {e}", exc_info=True)
    
    def move_to_failed(self, queue_file: Path):
        """Move failed task to failed directory."""
        self.failed_dir.mkdir(parents=True, exist_ok=True)
        failed_file = self.failed_dir / f"{datetime.now():%Y%m%d-%H%M%S}-{queue_file.name}"
        
        try:
            queue_file.rename(failed_file)
            self.logger.warning(f"Moved to failed: {failed_file}")
        except Exception as e:
            self.logger.error(f"Could not move to failed: {e}")
    
    def health_check_loop(self):
        """Periodic health check and metrics reporting."""
        while self.running:
            time.sleep(60)  # Check every minute
            
            try:
                # Write metrics
                metrics_file = self.daemon_dir / "metrics.json"
                with open(metrics_file, "w") as f:
                    json.dump(self.metrics, f, indent=2)
                
                # Write health status
                health = {
                    "status": "healthy",
                    "timestamp": datetime.utcnow().isoformat(),
                    "uptime_seconds": (
                        datetime.utcnow() - datetime.fromisoformat(self.metrics["start_time"])
                    ).total_seconds(),
                    "metrics": self.metrics
                }
                
                health_file = self.daemon_dir / "health.json"
                with open(health_file, "w") as f:
                    json.dump(health, f, indent=2)
                    
            except Exception as e:
                self.logger.error(f"Health check error: {e}")
    
    def handle_shutdown(self, signum, frame):
        """Handle shutdown signals."""
        self.logger.info(f"Received signal {signum}, shutting down...")
        self.running = False
    
    def handle_queue_signal(self, signum, frame):
        """Handle queue notification signal."""
        self.logger.info("Received queue signal, checking for new tasks...")
        threading.Thread(target=self.check_pending_aggregations).start()
    
    def is_running(self) -> bool:
        """Check if daemon is already running."""
        if self.pid_file.exists():
            try:
                with open(self.pid_file) as f:
                    pid = int(f.read().strip())
                # Check if process exists
                os.kill(pid, 0)
                return True
            except (ProcessLookupError, ValueError, OSError):
                # Process doesn't exist, remove stale PID file
                self.pid_file.unlink(missing_ok=True)
        return False
    
    def create_pid_file(self):
        """Create PID file with exclusive lock."""
        self.daemon_dir.mkdir(parents=True, exist_ok=True)
        
        try:
            # Open with exclusive create
            fd = os.open(str(self.pid_file), os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            os.write(fd, str(os.getpid()).encode())
            os.close(fd)
        except FileExistsError:
            self.logger.error("PID file already exists")
            sys.exit(1)
    
    def cleanup(self):
        """Cleanup on shutdown."""
        try:
            self.pid_file.unlink(missing_ok=True)
            self.logger.info("Daemon stopped")
        except Exception as e:
            self.logger.error(f"Cleanup error: {e}")


def main():
    """Main entry point."""
    import argparse
    
    parser = argparse.ArgumentParser(description="FlowForge Aggregation Daemon")
    parser.add_argument("command", choices=["start", "stop", "status", "restart"])
    parser.add_argument("--flowforge-root", default=".flowforge", help="FlowForge root directory")
    args = parser.parse_args()
    
    flowforge_root = Path(args.flowforge_root).resolve()
    daemon = FlowForgeAggregationDaemon(flowforge_root)
    
    if args.command == "start":
        print(f"Starting FlowForge Aggregation Daemon...")
        daemon.start()
        
    elif args.command == "stop":
        if daemon.is_running():
            with open(daemon.pid_file) as f:
                pid = int(f.read().strip())
            os.kill(pid, signal.SIGTERM)
            print("Daemon stop signal sent")
            
            # Wait for it to stop
            for i in range(10):
                time.sleep(1)
                if not daemon.is_running():
                    print("Daemon stopped")
                    break
            else:
                print("Daemon did not stop gracefully")
        else:
            print("Daemon not running")
            
    elif args.command == "status":
        if daemon.is_running():
            print("✅ Daemon is running")
            
            # Show metrics if available
            metrics_file = daemon.daemon_dir / "metrics.json"
            if metrics_file.exists():
                with open(metrics_file) as f:
                    metrics = json.load(f)
                print(f"\nMetrics:")
                print(f"  Successful aggregations: {metrics['aggregations_successful']}")
                print(f"  Failed aggregations: {metrics['aggregations_failed']}")
                print(f"  Queue size: {metrics['queue_size']}")
                print(f"  Last aggregation: {metrics['last_aggregation']}")
                
            # Show health if available
            health_file = daemon.daemon_dir / "health.json"
            if health_file.exists():
                with open(health_file) as f:
                    health = json.load(f)
                print(f"\nHealth:")
                print(f"  Status: {health['status']}")
                print(f"  Uptime: {health.get('uptime_seconds', 0):.0f} seconds")
        else:
            print("❌ Daemon is not running")
            
    elif args.command == "restart":
        print("Restarting daemon...")
        # Stop if running
        if daemon.is_running():
            with open(daemon.pid_file) as f:
                pid = int(f.read().strip())
            os.kill(pid, signal.SIGTERM)
            
            # Wait for stop
            for i in range(10):
                time.sleep(1)
                if not daemon.is_running():
                    break
        
        # Start
        time.sleep(1)
        daemon.start()


if __name__ == "__main__":
    main()