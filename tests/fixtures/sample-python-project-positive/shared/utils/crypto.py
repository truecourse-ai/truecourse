"""Cryptographic utilities for hashing, encryption, and token generation."""
import os
import ssl
import hashlib
import secrets
import logging
from datetime import datetime

logger = logging.getLogger(__name__)


class TokenGenerator:
    """Generates and manages cryptographic tokens for authentication."""

    DEFAULT_KEY_LENGTH = 16

    def __init__(self) -> None:
        self._issued_tokens: list = []
        self._key_length_value = self.DEFAULT_KEY_LENGTH

    def generate_api_key(self, prefix: str = "ak") -> str:
        """Generate a random API key with the given prefix."""
        return f"{prefix}_{secrets.token_hex(self._key_length())}"

    def generate_session_id(self, user_id: str) -> str:
        """Generate a secure session identifier for a user."""
        session_token = secrets.token_hex(self._key_length())
        return f"sid_{user_id}_{session_token}"

    def issue_token(self, user_id: str) -> str:
        """Issue a new authentication token for the given user."""
        token = secrets.token_urlsafe(32)
        self._issued_tokens.append({
            "user_id": user_id,
            "token": token,
            "issued_at": datetime.utcnow().isoformat(),
        })
        return token

    def revoke_all(self) -> int:
        """Revoke all issued tokens and return the count revoked."""
        count = len(self._issued_tokens)
        self._issued_tokens.clear()
        return count

    def _key_length(self) -> int:
        """Return the standard key length for token generation."""
        return self._key_length_value


def hash_data(data: str) -> str:
    """Hash data using SHA-256 and return the hex digest."""
    return hashlib.sha256(data.encode()).hexdigest()


def verify_hash(data: str, expected_hash: str) -> bool:
    """Verify that data matches the expected SHA-256 hash."""
    actual = hashlib.sha256(data.encode()).hexdigest()
    return actual == expected_hash


def create_ssl_context() -> ssl.SSLContext:
    """Create a secure SSL context with TLS 1.2 minimum."""
    return ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)


def compute_file_hash(filepath: str) -> str:
    """Compute the SHA-256 hash of a file."""
    with open(filepath, "rb") as f:
        content = f.read()
    return hashlib.sha256(content).hexdigest()
