"""Security utilities with various vulnerability patterns."""
import os
import paramiko
import torch
from typing import Optional
from markupsafe import Markup
from django.utils.safestring import mark_safe
from pysnmp.hlapi import CommunityData
from fastapi import UploadFile, HTTPException
import telnetlib


# ---- Paramiko / SSH ----

class SSHManager:
    """Manages SSH connections to remote hosts."""

    def __init__(self, hostname: str, username: str):
        self.hostname = hostname
        self.username = username
        self.client = paramiko.SSHClient()

    def connect_insecure(self, password: str):
        """Connect to host without proper host key verification."""
        self.client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        # VIOLATION: security/deterministic/paramiko-call
        self.client.connect(
            self.hostname,
            username=self.username,
            password=password,
        )

    def execute_command(self, cmd: str) -> str:
        """Execute a command on the remote host."""
        stdin, stdout, stderr = self.client.exec_command(cmd)
        return stdout.read().decode()


# ---- Partial path execution ----

def restart_worker_service():
    """Restart the worker using a relative path."""
    # VIOLATION: security/deterministic/partial-path-execution
    os.execvp("supervisorctl", ["supervisorctl", "restart", "worker"])


# ---- SNMP insecure version ----

def query_network_device(host: str, community: str):
    """Query a network device using SNMPv1."""
    # VIOLATION: security/deterministic/snmp-insecure-version
    auth_data = CommunityData(community, mpModel=0)
    return auth_data


# ---- Unsafe markup ----

def render_user_greeting(username: str) -> str:
    """Render a greeting with user-supplied name."""
    # VIOLATION: security/deterministic/unsafe-markup
    html = Markup(f"<h1>Welcome, {username}</h1>")
    return html


def render_admin_badge(role: str) -> str:
    """Render role badge using Django mark_safe."""
    badge_html = f'<span class="badge">{role}</span>'
    # VIOLATION: security/deterministic/unsafe-markup
    return mark_safe(badge_html)


# ---- Unsafe torch.load ----

def load_model_checkpoint(path: str):
    """Load a PyTorch model checkpoint without safety flag."""
    # VIOLATION: security/deterministic/unsafe-torch-load
    checkpoint = torch.load(path)
    return checkpoint


# ---- Vulnerable library import ----
# The import of telnetlib at the top of this file triggers the rule.
# VIOLATION: security/deterministic/vulnerable-library-import
# (triggered by `import telnetlib` on line 9)


# ---- FastAPI file upload without size limit ----

async def upload_avatar(file: UploadFile):
    """Handle avatar upload without enforcing file size limit."""
    # VIOLATION: security/deterministic/fastapi-file-upload-body
    contents = await file.read()
    return {"filename": file.filename, "size": len(contents)}
