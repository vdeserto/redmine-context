#!/usr/bin/env python3
"""
Time Aggregation Verification & Health Check
Ensures aggregation system is working correctly
"""

import os
import sys
import json
import hashlib
from pathlib import Path
from datetime import datetime, timedelta
from typing import Dict, List, Tuple

class AggregationVerifier:
    """Verify time aggregation integrity and health."""
    
    def __init__(self, flowforge_root: Path = None):
        self.flowforge_root = flowforge_root or Path(".flowforge")
        self.issues = []
        self.warnings = []
        self.info = []
    
    def verify_all(self) -> Tuple[bool, Dict]:
        """Run all verification checks."""
        print("🔍 FlowForge Time Aggregation Verification")
        print("=" * 50)
        
        results = {
            "timestamp": datetime.utcnow().isoformat(),
            "checks": {},
            "status": "healthy",
            "issues": [],
            "warnings": [],
            "recommendations": []
        }
        
        # Check 1: Directory structure
        print("\n📁 Checking directory structure...")
        if self.verify_directories():
            results["checks"]["directories"] = "✅ PASS"
            print("  ✅ All required directories exist")
        else:
            results["checks"]["directories"] = "❌ FAIL"
            results["status"] = "unhealthy"
        
        # Check 2: Git hooks
        print("\n🔗 Checking Git hooks...")
        if self.verify_git_hooks():
            results["checks"]["git_hooks"] = "✅ PASS"
            print("  ✅ Git hooks properly installed")
        else:
            results["checks"]["git_hooks"] = "❌ FAIL"
            results["status"] = "degraded"
        
        # Check 3: Current aggregation
        print("\n📊 Checking current aggregation...")
        agg_status = self.verify_current_aggregation()
        if agg_status["valid"]:
            results["checks"]["current_aggregation"] = "✅ PASS"
            print(f"  ✅ Last aggregation: {agg_status['age_minutes']:.0f} minutes ago")
        else:
            results["checks"]["current_aggregation"] = "⚠️ WARN"
            if agg_status["age_minutes"] > 60:
                results["status"] = "degraded"
        
        # Check 4: Data integrity
        print("\n🔐 Checking data integrity...")
        if self.verify_data_integrity():
            results["checks"]["data_integrity"] = "✅ PASS"
            print("  ✅ Data integrity verified")
        else:
            results["checks"]["data_integrity"] = "❌ FAIL"
            results["status"] = "unhealthy"
        
        # Check 5: Daemon status
        print("\n🤖 Checking daemon status...")
        daemon_status = self.check_daemon_status()
        results["checks"]["daemon"] = daemon_status["status"]
        print(f"  {daemon_status['icon']} Daemon: {daemon_status['message']}")
        
        # Check 6: Queue health
        print("\n📬 Checking queue health...")
        queue_status = self.check_queue_health()
        if queue_status["healthy"]:
            results["checks"]["queue"] = "✅ PASS"
            print(f"  ✅ Queue size: {queue_status['size']} items")
        else:
            results["checks"]["queue"] = "⚠️ WARN"
            print(f"  ⚠️ Queue size: {queue_status['size']} items (high)")
        
        # Check 7: Failed aggregations
        print("\n❌ Checking failed aggregations...")
        failed_status = self.check_failed_aggregations()
        if failed_status["count"] == 0:
            results["checks"]["failed"] = "✅ PASS"
            print("  ✅ No failed aggregations")
        else:
            results["checks"]["failed"] = "⚠️ WARN"
            print(f"  ⚠️ {failed_status['count']} failed aggregations")
        
        # Compile results
        results["issues"] = self.issues
        results["warnings"] = self.warnings
        results["info"] = self.info
        
        # Generate recommendations
        if results["status"] != "healthy":
            results["recommendations"] = self.generate_recommendations(results)
        
        # Print summary
        self.print_summary(results)
        
        return results["status"] == "healthy", results
    
    def verify_directories(self) -> bool:
        """Verify required directory structure exists."""
        required_dirs = [
            self.flowforge_root / "team" / "summaries",
            self.flowforge_root / "daemon",
            self.flowforge_root / "recovery"
        ]
        
        all_exist = True
        for dir_path in required_dirs:
            if not dir_path.exists():
                self.issues.append(f"Missing directory: {dir_path}")
                all_exist = False
        
        return all_exist
    
    def verify_git_hooks(self) -> bool:
        """Verify Git hooks are installed."""
        git_dir = Path(".git")
        if not git_dir.exists():
            self.warnings.append("Not in a Git repository")
            return False
        
        pre_commit = git_dir / "hooks" / "pre-commit"
        if not pre_commit.exists():
            self.issues.append("Pre-commit hook not installed")
            return False
        
        if not os.access(pre_commit, os.X_OK):
            self.issues.append("Pre-commit hook not executable")
            return False
        
        return True
    
    def verify_current_aggregation(self) -> Dict:
        """Verify current aggregation status."""
        current_file = self.flowforge_root / "team" / "summaries" / "current.json"
        
        if not current_file.exists():
            self.warnings.append("No current aggregation found")
            return {"valid": False, "age_minutes": float('inf')}
        
        try:
            with open(current_file) as f:
                data = json.load(f)
            
            # Check age
            timestamp = data.get("timestamp", "1970-01-01T00:00:00Z").rstrip("Z")
            agg_time = datetime.fromisoformat(timestamp)
            age = datetime.utcnow() - agg_time
            age_minutes = age.total_seconds() / 60
            
            if age_minutes > 30:
                self.warnings.append(f"Aggregation is {age_minutes:.0f} minutes old")
            
            return {
                "valid": True,
                "age_minutes": age_minutes,
                "data": data
            }
            
        except Exception as e:
            self.issues.append(f"Error reading current aggregation: {e}")
            return {"valid": False, "age_minutes": float('inf')}
    
    def verify_data_integrity(self) -> bool:
        """Verify data integrity with checksums."""
        current_file = self.flowforge_root / "team" / "summaries" / "current.json"
        
        if not current_file.exists():
            return True  # No data to verify
        
        try:
            with open(current_file) as f:
                data = json.load(f)
            
            # Check if checksum exists
            stored_checksum = data.get("metadata", {}).get("checksum")
            if not stored_checksum:
                self.warnings.append("No checksum in current aggregation")
                return True  # Not a failure, just a warning
            
            # Verify checksum
            data_copy = json.loads(json.dumps(data))
            if "checksum" in data_copy.get("metadata", {}):
                del data_copy["metadata"]["checksum"]
            
            calculated_checksum = hashlib.sha256(
                json.dumps(data_copy, sort_keys=True).encode()
            ).hexdigest()
            
            if stored_checksum != calculated_checksum:
                self.issues.append("Checksum mismatch - data may be corrupted")
                return False
            
            return True
            
        except Exception as e:
            self.issues.append(f"Error verifying integrity: {e}")
            return False
    
    def check_daemon_status(self) -> Dict:
        """Check if daemon is running."""
        pid_file = self.flowforge_root / "daemon" / "flowforge-daemon.pid"
        
        if not pid_file.exists():
            return {
                "status": "⚫ NOT_CONFIGURED",
                "icon": "⚫",
                "message": "Not configured (optional)",
                "running": False
            }
        
        try:
            with open(pid_file) as f:
                pid = int(f.read().strip())
            
            # Check if process exists
            os.kill(pid, 0)
            
            # Check health file
            health_file = self.flowforge_root / "daemon" / "health.json"
            if health_file.exists():
                with open(health_file) as f:
                    health = json.load(f)
                
                uptime = health.get("uptime_seconds", 0)
                return {
                    "status": "✅ RUNNING",
                    "icon": "✅",
                    "message": f"Running (uptime: {uptime:.0f}s)",
                    "running": True
                }
            
            return {
                "status": "✅ RUNNING",
                "icon": "✅",
                "message": "Running",
                "running": True
            }
            
        except (ProcessLookupError, ValueError, OSError):
            return {
                "status": "❌ STOPPED",
                "icon": "❌",
                "message": "Not running",
                "running": False
            }
    
    def check_queue_health(self) -> Dict:
        """Check aggregation queue health."""
        queue_dir = self.flowforge_root / "daemon" / "queue"
        
        if not queue_dir.exists():
            return {"healthy": True, "size": 0}
        
        queue_files = list(queue_dir.glob("*.json"))
        queue_size = len(queue_files)
        
        # Check for old items
        old_items = 0
        for queue_file in queue_files:
            try:
                age = datetime.now() - datetime.fromtimestamp(queue_file.stat().st_mtime)
                if age > timedelta(hours=1):
                    old_items += 1
            except:
                pass
        
        if old_items > 0:
            self.warnings.append(f"{old_items} queue items older than 1 hour")
        
        return {
            "healthy": queue_size < 50,
            "size": queue_size,
            "old_items": old_items
        }
    
    def check_failed_aggregations(self) -> Dict:
        """Check for failed aggregations."""
        failed_dir = self.flowforge_root / "daemon" / "failed"
        
        if not failed_dir.exists():
            return {"count": 0}
        
        failed_files = list(failed_dir.glob("*.json"))
        
        if len(failed_files) > 0:
            self.warnings.append(f"{len(failed_files)} failed aggregations need attention")
        
        return {"count": len(failed_files)}
    
    def generate_recommendations(self, results: Dict) -> List[str]:
        """Generate recommendations based on issues found."""
        recommendations = []
        
        if "directories" in results["checks"] and "FAIL" in results["checks"]["directories"]:
            recommendations.append("Run: .flowforge/scripts/deploy-time-aggregation.sh")
        
        if "git_hooks" in results["checks"] and "FAIL" in results["checks"]["git_hooks"]:
            recommendations.append("Reinstall Git hooks: .flowforge/scripts/deploy-time-aggregation.sh")
        
        if results["checks"].get("daemon") == "❌ STOPPED":
            recommendations.append("Start daemon: python3 .flowforge/scripts/aggregation-daemon.py start")
        
        if len(self.issues) > 0:
            recommendations.append("Review and fix reported issues")
        
        return recommendations
    
    def print_summary(self, results: Dict):
        """Print verification summary."""
        print("\n" + "=" * 50)
        print("📋 VERIFICATION SUMMARY")
        print("=" * 50)
        
        # Status
        status_icon = {
            "healthy": "✅",
            "degraded": "⚠️",
            "unhealthy": "❌"
        }.get(results["status"], "❓")
        
        print(f"\nOverall Status: {status_icon} {results['status'].upper()}")
        
        # Issues
        if self.issues:
            print(f"\n❌ Issues ({len(self.issues)}):")
            for issue in self.issues:
                print(f"  • {issue}")
        
        # Warnings
        if self.warnings:
            print(f"\n⚠️ Warnings ({len(self.warnings)}):")
            for warning in self.warnings:
                print(f"  • {warning}")
        
        # Recommendations
        if results.get("recommendations"):
            print(f"\n💡 Recommendations:")
            for i, rec in enumerate(results["recommendations"], 1):
                print(f"  {i}. {rec}")
        
        # Save report
        report_file = self.flowforge_root / "daemon" / "verification-report.json"
        report_file.parent.mkdir(parents=True, exist_ok=True)
        with open(report_file, "w") as f:
            json.dump(results, f, indent=2)
        
        print(f"\n📄 Full report saved to: {report_file}")
        
        if results["status"] == "healthy":
            print("\n✅ TIME TRACKING SYSTEM IS HEALTHY!")
            print("Your billing data is being tracked correctly.")
        else:
            print("\n⚠️ ATTENTION REQUIRED!")
            print("Follow recommendations above to fix issues.")


def main():
    """Main entry point."""
    import argparse
    
    parser = argparse.ArgumentParser(description="Verify FlowForge Time Aggregation")
    parser.add_argument("--flowforge-root", default=".flowforge", help="FlowForge root directory")
    parser.add_argument("--json", action="store_true", help="Output JSON format")
    parser.add_argument("--fix", action="store_true", help="Attempt to fix issues")
    args = parser.parse_args()
    
    flowforge_root = Path(args.flowforge_root).resolve()
    verifier = AggregationVerifier(flowforge_root)
    
    if args.fix:
        print("🔧 Running in FIX mode...")
        # Add fix logic here
        print("Fix mode not yet implemented")
        return
    
    success, results = verifier.verify_all()
    
    if args.json:
        print(json.dumps(results, indent=2))
    
    # Exit with appropriate code
    if results["status"] == "healthy":
        sys.exit(0)
    elif results["status"] == "degraded":
        sys.exit(1)
    else:
        sys.exit(2)


if __name__ == "__main__":
    main()