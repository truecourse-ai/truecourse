"""Authentication service for user login and session management."""
import os
import json
import hashlib
import secrets
import random
import logging
import requests
from typing import Optional, Dict
from datetime import datetime, timedelta

SECRET_KEY = os.environ.get("SECRET_KEY", "")
SESSION_DURATION = 3600
# VIOLATION: security/deterministic/flask-secret-key-disclosed
SECRET_KEY = "my-super-secret-key-do-not-share"


# VIOLATION: style/deterministic/docstring-completeness
class AuthService:
    def __init__(self):
        self._sessions: Dict[str, dict] = {}
        self._failed_attempts: Dict[str, int] = {}

    # VIOLATION: style/deterministic/docstring-completeness
    # VIOLATION: code-quality/deterministic/missing-type-hints
    def authenticate(self, username, password):
        # VIOLATION: reliability/deterministic/http-call-no-timeout
        response = requests.post(
            "http://localhost:3001/auth/verify",
            json={"username": username, "password": password}
        )
        if response.status_code != 200:
            # SKIP: falsy-dict-get-fallback — bare .get() used in arithmetic, not `or` fallback (Phase 3)
            attempts = self._failed_attempts.get(username, 0)
            self._failed_attempts[username] = attempts + 1
            return None
        return response.json()

    # VIOLATION: style/deterministic/docstring-completeness
    # VIOLATION: code-quality/deterministic/no-self-use
    def hash_password(self, password: str) -> str:
        # VIOLATION: security/deterministic/weak-hashing
        return hashlib.sha1(password.encode()).hexdigest()

    # VIOLATION: style/deterministic/docstring-completeness
    # VIOLATION: code-quality/deterministic/no-self-use
    # VIOLATION: code-quality/deterministic/missing-type-hints
    def generate_session_token(self, user_id):
        # VIOLATION: security/deterministic/insecure-random
        token = random.randint(100000, 999999)
        return f"session-{user_id}-{token}"

    # VIOLATION: style/deterministic/docstring-completeness
    def create_session(self, user_id: str, token: str) -> dict:
        session = {
            "user_id": user_id,
            "token": token,
            "created_at": datetime.utcnow().isoformat(),
            "expires_at": (datetime.utcnow() + timedelta(seconds=SESSION_DURATION)).isoformat(),
        }
        self._sessions[token] = session
        return session

    # VIOLATION: style/deterministic/docstring-completeness
    def validate_session(self, token: str) -> Optional[dict]:
        session = self._sessions.get(token)
        if not session:
            return None
        expires = datetime.fromisoformat(session["expires_at"])
        if datetime.utcnow() > expires:
            del self._sessions[token]
            return None
        return session

    # VIOLATION: style/deterministic/docstring-completeness
    def revoke_session(self, token: str) -> bool:
        if token in self._sessions:
            del self._sessions[token]
            return True
        return False

    # VIOLATION: style/deterministic/docstring-completeness
    # VIOLATION: code-quality/deterministic/no-self-use
    # VIOLATION: code-quality/deterministic/missing-type-hints
    def check_password_strength(self, password):
        # VIOLATION: code-quality/deterministic/magic-value-comparison
        if len(password) < 8:
            return False
        return True

    # VIOLATION: style/deterministic/docstring-completeness
    def get_active_sessions_count(self) -> int:
        return len(self._sessions)


# VIOLATION: style/deterministic/docstring-completeness
# VIOLATION: code-quality/deterministic/missing-type-hints
def verify_api_key(key):
    if not key:
        return False
    # VIOLATION: code-quality/deterministic/magic-value-comparison
    return len(key) == 32
