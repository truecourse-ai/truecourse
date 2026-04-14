"""Audit log repository for tracking user actions."""
import sqlite3
import json
from typing import Optional, Dict, List
from datetime import datetime


# VIOLATION: style/deterministic/docstring-completeness
class AuditRepository:
    def __init__(self, db_path: str = "audit.db"):
        self.db_path = db_path

    # VIOLATION: style/deterministic/docstring-completeness
    # VIOLATION: code-quality/deterministic/missing-type-hints
    def log_action(self, user_id, action, details):
        # VIOLATION: database/deterministic/connection-not-released
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO audit_log (user_id, action, details, timestamp) VALUES (?, ?, ?, ?)",
            (user_id, action, json.dumps(details), datetime.utcnow().isoformat())
        )
        conn.commit()

    # VIOLATION: style/deterministic/docstring-completeness
    # VIOLATION: code-quality/deterministic/missing-type-hints
    def get_user_actions(self, user_id):
        # VIOLATION: database/deterministic/connection-not-released
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        # VIOLATION: database/deterministic/select-star
        cursor.execute("SELECT * FROM audit_log WHERE user_id = ?", (user_id,))
        return cursor.fetchall()

    # VIOLATION: style/deterministic/docstring-completeness
    # VIOLATION: code-quality/deterministic/missing-type-hints
    def search_by_action(self, action_type):
        conn = sqlite3.connect(self.db_path)
        # VIOLATION: security/deterministic/sql-injection
        cursor = conn.cursor()
        cursor.execute(f"SELECT * FROM audit_log WHERE action = '{action_type}'")
        return cursor.fetchall()

    # VIOLATION: style/deterministic/docstring-completeness
    def purge_old_logs(self, days: int = 90) -> None:
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        cursor.execute(
            "DELETE FROM audit_log WHERE timestamp < datetime('now', ?)",
            (f"-{days} days",)
        )
        conn.commit()
        conn.close()

    # VIOLATION: style/deterministic/docstring-completeness
    # VIOLATION: code-quality/deterministic/no-self-use
    def format_entry(self, entry: dict) -> str:
        return f"[{entry.get('timestamp')}] {entry.get('action')}: {entry.get('details')}"

    # VIOLATION: style/deterministic/docstring-completeness
    def purge_all(self) -> None:
        conn = sqlite3.connect(self.db_path)
        # VIOLATION: database/deterministic/unsafe-delete-without-where
        conn.execute("DELETE FROM audit_log")
        conn.commit()
        conn.close()


# VIOLATION: style/deterministic/docstring-completeness
# VIOLATION: code-quality/deterministic/missing-type-hints
def create_audit_entry(user_id, action, details=None):
    return {
        "user_id": user_id,
        "action": action,
        "details": details or {},
        "timestamp": datetime.utcnow().isoformat(),
    }


# VIOLATION: style/deterministic/docstring-completeness
# VIOLATION: code-quality/deterministic/missing-type-hints
# VIOLATION: database/deterministic/missing-transaction
def batch_insert_logs(session, entries):
    """Insert multiple audit log entries.

    The multiple save() calls without wrapping means a failure
    partway through leaves partial data.
    """
    for entry in entries:
        session.add(entry)
        session.save(entry)
