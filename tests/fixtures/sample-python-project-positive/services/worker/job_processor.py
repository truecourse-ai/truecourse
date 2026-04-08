"""Background job processor for scheduled tasks."""
import os
import sqlite3
import logging

import requests

logger = logging.getLogger(__name__)

JOB_DB_PATH = os.environ.get("JOB_DB_PATH", "jobs.db")
JOB_TYPE_EMAIL = "email"
JOB_TYPE_REPORT = "report"
JOB_TYPE_CLEANUP = "cleanup"
HTTP_TIMEOUT = 30


class JobProcessor:
    """Processes background jobs from a database queue."""

    def __init__(self, db_path: str = JOB_DB_PATH) -> None:
        self.db_path = db_path
        self._running = False
        self._processed = 0

    def fetch_pending_jobs(self) -> list:
        """Fetch all pending jobs from the database."""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT id, type, data FROM jobs WHERE status = 'pending'")
            return cursor.fetchall()

    def process_job(self, job: dict) -> None:
        """Process a single job by type."""
        job_type = job.get("type", "unknown")
        try:
            if job_type == JOB_TYPE_EMAIL:
                self._handle_email_job(job)
            elif job_type == JOB_TYPE_REPORT:
                self._handle_report_job(job)
            elif job_type == JOB_TYPE_CLEANUP:
                self._handle_cleanup_job(job)
            else:
                logger.warning("Unknown job type: %s", job_type)
        except (OSError, ValueError) as exc:
            logger.exception("Job processing failed: %s", exc)

    def _handle_email_job(self, job: dict) -> None:
        """Handle an email sending job."""
        self._processed += 1
        requests.post("http://localhost:8080/send-email", json=job, timeout=HTTP_TIMEOUT)

    def _handle_report_job(self, job: dict) -> None:
        """Generate a report for the given job."""
        self._processed += 1
        logger.info("Generating report for job: %s", job.get("report_id"))

    def _handle_cleanup_job(self, job: dict) -> None:
        """Execute cleanup tasks."""
        self._processed += 1
        logger.info("Running cleanup for job: %s", job.get("id"))

    def get_stats(self) -> dict:
        """Return processor statistics."""
        return {
            "processed": self._processed,
            "running": self._running,
        }


def run_worker(db_path: str) -> dict:
    """Run the worker to process all pending jobs."""
    processor = JobProcessor(db_path)
    jobs = processor.fetch_pending_jobs()
    for job in jobs:
        processor.process_job(job)
    return processor.get_stats()
