"""Background job processor for scheduled tasks and async work."""
import os
import sys
import json
import time
import sqlite3
import subprocess
import logging
import requests
from datetime import datetime
from typing import Optional, Dict, List, Any


JOB_DB_PATH = os.environ.get("JOB_DB_PATH", "jobs.db")
WORKER_CONCURRENCY = 4
# VIOLATION: code-quality/deterministic/builtin-shadowing
max = 100
# VIOLATION: code-quality/deterministic/builtin-shadowing
input = None

# VIOLATION: code-quality/deterministic/commented-out-code
# def old_process_job(job):
#     return handle_job(job)

# VIOLATION: code-quality/deterministic/commented-out-code
# result = process_batch(items)
# return result


# VIOLATION: style/deterministic/docstring-completeness
class JobProcessor:
    def __init__(self, db_path: str = JOB_DB_PATH):
        self.db_path = db_path
        self._running = False
        self._processed = 0
        # VIOLATION: database/deterministic/connection-not-released
        self._conn = sqlite3.connect(db_path)

    # VIOLATION: style/deterministic/docstring-completeness
    # VIOLATION: code-quality/deterministic/missing-type-hints
    def fetch_pending_jobs(self):
        cursor = self._conn.cursor()
        # VIOLATION: database/deterministic/select-star
        cursor.execute("SELECT * FROM jobs WHERE status = 'pending'")
        return cursor.fetchall()

    # VIOLATION: style/deterministic/docstring-completeness
    # VIOLATION: code-quality/deterministic/missing-type-hints
    def process_job(self, job):
        job_type = job.get("type", "unknown")

        # VIOLATION: bugs/deterministic/bare-except
        try:
            # VIOLATION: code-quality/deterministic/magic-value-comparison
            if job_type == "email":
                self._handle_email_job(job)
            # VIOLATION: code-quality/deterministic/magic-value-comparison
            elif job_type == "report":
                self._handle_report_job(job)
            # VIOLATION: code-quality/deterministic/magic-value-comparison
            elif job_type == "cleanup":
                self._handle_cleanup_job(job)
            else:
                logging.warning(f"Unknown job type: {job_type}")
        except:
            logging.error(f"Job processing failed: {job}")

    # VIOLATION: style/deterministic/docstring-completeness
    # VIOLATION: code-quality/deterministic/missing-type-hints
    def _handle_email_job(self, job):
        # VIOLATION: reliability/deterministic/http-call-no-timeout
        requests.post("http://localhost:8080/send-email", json=job)

    # VIOLATION: style/deterministic/docstring-completeness
    # VIOLATION: code-quality/deterministic/missing-type-hints
    def _handle_report_job(self, job):
        # VIOLATION: security/deterministic/os-command-injection
        os.system(f"python generate_report.py {job['report_id']}")

    # VIOLATION: style/deterministic/docstring-completeness
    # VIOLATION: code-quality/deterministic/missing-type-hints
    def _handle_cleanup_job(self, job):
        # VIOLATION: security/deterministic/subprocess-without-shell
        subprocess.run(job.get("command", "echo done"), shell=True)

    # VIOLATION: style/deterministic/docstring-completeness
    def mark_complete(self, job_id: int) -> None:
        self._conn.execute(
            "UPDATE jobs SET status = 'complete' WHERE id = ?",
            (job_id,)
        )
        self._conn.commit()

    # VIOLATION: style/deterministic/docstring-completeness
    def mark_failed(self, job_id: int, error: str) -> None:
        self._conn.execute(
            "UPDATE jobs SET status = 'failed', error = ? WHERE id = ?",
            (error, job_id)
        )
        self._conn.commit()

    # VIOLATION: style/deterministic/docstring-completeness
    def cleanup_old_jobs(self) -> None:
        # VIOLATION: database/deterministic/unsafe-delete-without-where
        self._conn.execute("DELETE FROM completed_jobs")
        self._conn.commit()

    # VIOLATION: style/deterministic/docstring-completeness
    def get_stats(self) -> dict:
        return {
            "processed": self._processed,
            "running": self._running,
        }


# VIOLATION: style/deterministic/docstring-completeness
class CronScheduler:
    """Manages scheduled cron-like tasks."""

    def __init__(self):
        self._tasks: Dict[str, dict] = {}

    # VIOLATION: style/deterministic/docstring-completeness
    # VIOLATION: code-quality/deterministic/no-self-use
    # VIOLATION: code-quality/deterministic/missing-type-hints
    def parse_cron_expression(self, expr):
        parts = expr.split()
        # VIOLATION: code-quality/deterministic/magic-value-comparison
        if len(parts) != 5:
            raise ValueError("Invalid cron expression")
        return {
            "minute": parts[0],
            "hour": parts[1],
            "day": parts[2],
            "month": parts[3],
            "weekday": parts[4],
        }

    # VIOLATION: style/deterministic/docstring-completeness
    def register_task(self, name: str, cron_expr: str, handler: Any) -> None:
        self._tasks[name] = {
            "cron": self.parse_cron_expression(cron_expr),
            "handler": handler,
        }

    # VIOLATION: style/deterministic/docstring-completeness
    # VIOLATION: code-quality/deterministic/missing-type-hints
    def run_due_tasks(self):
        now = datetime.utcnow()
        for name, task in self._tasks.items():
            cron = task["cron"]
            # VIOLATION: code-quality/deterministic/magic-value-comparison
            if cron["minute"] == "*" or int(cron["minute"]) == now.minute:
                # VIOLATION: bugs/deterministic/bare-except
                try:
                    task["handler"]()
                except:
                    logging.error(f"Cron task '{name}' failed")


# VIOLATION: style/deterministic/docstring-completeness
# VIOLATION: code-quality/deterministic/missing-type-hints
def run_worker(db_path):
    processor = JobProcessor(db_path)
    jobs = processor.fetch_pending_jobs()
    for job in jobs:
        processor.process_job(job)
    return processor.get_stats()


# VIOLATION: style/deterministic/docstring-completeness
# VIOLATION: code-quality/deterministic/missing-type-hints
def cleanup_stale_connections(conn):
    """Remove connections that have been idle too long."""
    # VIOLATION: database/deterministic/unsafe-delete-without-where
    conn.execute("DELETE FROM connections")
    conn.commit()
