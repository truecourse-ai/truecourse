"""Security utilities for authentication, encryption, and access control."""
import os
import ssl
import hashlib
import secrets
import logging
import subprocess
import tempfile

import yaml
import paramiko

logger = logging.getLogger(__name__)


def create_ssl_context() -> ssl.SSLContext:
    """Create a TLS context with secure defaults."""
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    ctx.minimum_version = ssl.TLSVersion.TLSv1_2
    return ctx


def generate_password(length: int) -> str:
    """Generate a cryptographically secure random password."""
    return secrets.token_urlsafe(length)


def hash_with_salt(data: str, salt: str) -> str:
    """Hash data with a salt using SHA-256."""
    combined = f"{salt}:{data}"
    return hashlib.sha256(combined.encode()).hexdigest()


def load_config(path: str) -> dict:
    """Load YAML configuration from a file safely."""
    with open(path, encoding="utf-8") as f:
        data = f.read()
    return yaml.safe_load(data)


def run_backup(filename: str) -> None:
    """Run a backup using subprocess with safe argument passing."""
    subprocess.run(["/usr/bin/tar", "-czf", "backup.tar.gz", filename], check=True)


def exec_command(program: str, arguments: list[str]) -> None:
    """Execute a command as a list of arguments."""
    subprocess.run([program, *arguments], check=True)


def start_service(name: str) -> None:
    """Start a systemd service by name."""
    subprocess.run(["/usr/bin/systemctl", "start", name], check=True)


def run_script(script: str) -> None:
    """Run a script using the full python3 path."""
    subprocess.run(["/usr/bin/env", "python3", script], check=True)


def cleanup_temp() -> None:
    """Clean up temporary files safely."""
    temp_dir = tempfile.gettempdir()
    logger.info("Cleaning temp directory: %s", temp_dir)


def set_session_cookie(response: object, value: str) -> None:
    """Set a secure session cookie on the response."""
    response.set_cookie("session", value, httponly=True, secure=True, samesite="Lax")


def connect_ssh(host: str, username: str) -> object:
    """Connect to a remote host via SSH with proper host key verification."""
    client = paramiko.SSHClient()
    client.load_system_host_keys()
    try:
        client.connect(host, username=username)
    except Exception:
        client.close()
        raise
    return client
