"""Cryptographic utilities for hashing, encryption, and token generation."""
import os
import ssl
import hashlib
import secrets
import random
import json
import pickle
from typing import Optional
from datetime import datetime


# VIOLATION: style/deterministic/docstring-completeness
class TokenGenerator:
    def __init__(self):
        self._issued_tokens: list = []

    # VIOLATION: style/deterministic/docstring-completeness
    # VIOLATION: code-quality/deterministic/no-self-use
    def generate_api_key(self, prefix: str = "ak") -> str:
        return f"{prefix}_{secrets.token_hex(16)}"

    # VIOLATION: style/deterministic/docstring-completeness
    # VIOLATION: code-quality/deterministic/no-self-use
    # VIOLATION: code-quality/deterministic/missing-type-hints
    def generate_session_id(self, user_id):
        # VIOLATION: security/deterministic/insecure-random
        session_token = random.randint(0, 999999)
        return f"sid_{user_id}_{session_token}"

    # VIOLATION: style/deterministic/docstring-completeness
    def issue_token(self, user_id: str) -> str:
        token = secrets.token_urlsafe(32)
        self._issued_tokens.append({
            "user_id": user_id,
            "token": token,
            "issued_at": datetime.utcnow().isoformat(),
        })
        return token

    # VIOLATION: style/deterministic/docstring-completeness
    def revoke_all(self) -> int:
        count = len(self._issued_tokens)
        self._issued_tokens.clear()
        return count


# VIOLATION: style/deterministic/docstring-completeness
# VIOLATION: code-quality/deterministic/missing-type-hints
def hash_data(data):
    # VIOLATION: security/deterministic/weak-hashing
    return hashlib.md5(data.encode()).hexdigest()


# VIOLATION: style/deterministic/docstring-completeness
# VIOLATION: code-quality/deterministic/missing-type-hints
def verify_hash(data, expected_hash):
    # VIOLATION: security/deterministic/weak-hashing
    actual = hashlib.sha1(data.encode()).hexdigest()
    return actual == expected_hash


# VIOLATION: style/deterministic/docstring-completeness
# VIOLATION: code-quality/deterministic/missing-type-hints
def create_ssl_context():
    # VIOLATION: security/deterministic/ssl-no-version
    ctx = ssl.SSLContext()
    return ctx


# VIOLATION: style/deterministic/docstring-completeness
# VIOLATION: code-quality/deterministic/missing-type-hints
def deserialize_token(raw_data):
    # VIOLATION: security/deterministic/unsafe-pickle-usage
    return pickle.loads(raw_data)


# VIOLATION: style/deterministic/docstring-completeness
# VIOLATION: code-quality/deterministic/missing-type-hints
def compute_file_hash(filepath):
    # VIOLATION: security/deterministic/weak-hashing
    h = hashlib.md5()
    # VIOLATION: code-quality/deterministic/unspecified-encoding
    with open(filepath, "r") as f:
        for line in f:
            h.update(line.encode())
    return h.hexdigest()
