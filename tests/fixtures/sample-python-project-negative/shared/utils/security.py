"""Security utilities for authentication, encryption, and access control."""
import os
import ssl
import jwt
import hashlib
import random
import pickle
import tempfile
import subprocess
from typing import Optional, Dict
from datetime import datetime
from flask import Flask


# ---- AWS keys ----

# VIOLATION: security/deterministic/long-term-aws-keys-in-code
AWS_ACCESS_KEY_ID = "AKIAIOSFODNN7EXAMPLE"
AWS_SECRET_ACCESS_KEY = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"


# ---- Flask secret key ----

app = Flask(__name__)
# VIOLATION: security/deterministic/flask-secret-key-disclosed
app.secret_key = "super-secret-hardcoded-key"


# ---- Debug mode ----

# VIOLATION: security/deterministic/production-debug-enabled
app.debug = True


# ---- SSL/TLS issues ----

# VIOLATION: security/deterministic/weak-ssl
weak_ctx = ssl.SSLContext(ssl.PROTOCOL_SSLv3)

# VIOLATION: security/deterministic/ssl-version-unsafe
ctx2 = ssl.SSLContext()
ctx2.minimum_version = ssl.TLSVersion.TLSv1

# VIOLATION: security/deterministic/unverified-certificate
insecure_ctx = ssl._create_unverified_context()

# VIOLATION: security/deterministic/unverified-hostname
hostname_ctx = ssl.SSLContext()
hostname_ctx.check_hostname = False


# ---- Weak crypto ----

from cryptography.hazmat.primitives.asymmetric import rsa

# VIOLATION: security/deterministic/weak-crypto-key
private_key = rsa.generate_private_key(
    public_exponent=65537,
    key_size=1024,
)


# ---- Insecure JWT ----

# VIOLATION: security/deterministic/insecure-jwt
token = jwt.encode({"user": "admin"}, "secret", algorithm="none")


# ---- Weak cipher ----

from Crypto.Cipher import DES, AES

# VIOLATION: security/deterministic/weak-cipher
cipher = DES.new(b"12345678", DES.MODE_ECB)

# VIOLATION: security/deterministic/encryption-insecure-mode
key = b"0123456789abcdef"
ecb_cipher = AES.new(key, AES.MODE_ECB)


# ---- Unverified requests ----

import requests

# VIOLATION: security/deterministic/unverified-certificate
resp = requests.get("https://api.example.com", verify=False)


# ---- Unsafe temp file ----

# VIOLATION: security/deterministic/unsafe-temp-file
tmp = tempfile.mktemp()


# ---- Unsafe YAML ----

import yaml

# VIOLATION: style/deterministic/docstring-completeness
# VIOLATION: code-quality/deterministic/missing-type-hints
def load_config(path):
    with open(path) as f:
        data = f.read()
    # VIOLATION: security/deterministic/unsafe-yaml-load
    return yaml.load(data)


# ---- Confidential info logging ----

import logging

password = "secret123"
# VIOLATION: security/deterministic/confidential-info-logging
logging.info("User credentials: %s", password)


# ---- Subprocess patterns ----

# VIOLATION: style/deterministic/docstring-completeness
# VIOLATION: code-quality/deterministic/missing-type-hints
def run_backup(filename):
    # VIOLATION: security/deterministic/os-command-injection
    os.system(f"tar -czf backup.tar.gz {filename}")


# VIOLATION: style/deterministic/docstring-completeness
# VIOLATION: code-quality/deterministic/missing-type-hints
def exec_command(cmd):
    # VIOLATION: security/deterministic/subprocess-without-shell
    subprocess.run(cmd, shell=True)


# VIOLATION: style/deterministic/docstring-completeness
# VIOLATION: code-quality/deterministic/missing-type-hints
def start_service(name):
    # VIOLATION: security/deterministic/process-start-no-shell
    subprocess.Popen(f"systemctl start {name}")


# VIOLATION: style/deterministic/docstring-completeness
# VIOLATION: code-quality/deterministic/missing-type-hints
def run_python(script):
    # VIOLATION: security/deterministic/process-with-partial-path
    subprocess.run(["curl", script])


# VIOLATION: style/deterministic/docstring-completeness
# VIOLATION: code-quality/deterministic/missing-type-hints
def cleanup_temp():
    # VIOLATION: security/deterministic/wildcard-in-os-command
    os.system("rm -rf /tmp/*")


# ---- Eval usage ----

# VIOLATION: style/deterministic/docstring-completeness
# VIOLATION: code-quality/deterministic/missing-type-hints
def dynamic_eval(expr):
    # VIOLATION: security/deterministic/eval-usage
    return eval(expr)


# VIOLATION: style/deterministic/docstring-completeness
# VIOLATION: code-quality/deterministic/missing-type-hints
def dynamic_exec(code):
    # VIOLATION: security/deterministic/eval-usage
    exec(code)


# ---- File permissions ----

# VIOLATION: security/deterministic/file-permissions-world-accessible
os.chmod("/tmp/data.txt", 0o777)

# VIOLATION: security/deterministic/non-octal-file-permissions
os.chmod("/tmp/data.txt", 777)


# ---- Insecure random in security context ----

# VIOLATION: style/deterministic/docstring-completeness
# VIOLATION: code-quality/deterministic/missing-type-hints
def generate_password(length):
    # VIOLATION: security/deterministic/insecure-random
    password = random.randint(0, 999999)
    return str(password)


# ---- Django raw SQL ----

# VIOLATION: style/deterministic/docstring-completeness
# VIOLATION: code-quality/deterministic/missing-type-hints
def django_raw_query(user_input):
    from django.db import models
    # VIOLATION: security/deterministic/django-raw-sql
    users = models.User.objects.raw(f"SELECT * FROM users WHERE name = '{user_input}'")
    return users


# ---- Unsafe unzip ----

import zipfile

# VIOLATION: style/deterministic/docstring-completeness
# VIOLATION: code-quality/deterministic/missing-type-hints
def extract_archive(zip_path, dest):
    zip_archive = zipfile.ZipFile(zip_path)
    # VIOLATION: security/deterministic/unsafe-unzip
    zip_archive.extractall(dest)


# ---- XML XXE ----

from xml.etree import ElementTree

# VIOLATION: style/deterministic/docstring-completeness
# VIOLATION: code-quality/deterministic/missing-type-hints
def parse_xml(xml_str):
    # VIOLATION: security/deterministic/xml-xxe
    return ElementTree.fromstring(xml_str)


# ---- Disabled auto-escaping ----

from jinja2 import Environment

# VIOLATION: security/deterministic/disabled-auto-escaping
env = Environment(autoescape=False)


# ---- Insecure cookie ----

# VIOLATION: style/deterministic/docstring-completeness
# VIOLATION: code-quality/deterministic/missing-type-hints
def set_session_cookie(response, value):
    # VIOLATION: security/deterministic/insecure-cookie
    response.set_cookie("session", value, httponly=False, secure=False)


# ---- Suspicious URL open ----

import urllib.request

# VIOLATION: style/deterministic/docstring-completeness
# VIOLATION: code-quality/deterministic/missing-type-hints
def fetch_url(url):
    # VIOLATION: security/deterministic/suspicious-url-open
    return urllib.request.urlopen(url)


# ---- SSH no host key verification ----

import paramiko

# VIOLATION: style/deterministic/docstring-completeness
# VIOLATION: code-quality/deterministic/missing-type-hints
def connect_ssh(host, username):
    client = paramiko.SSHClient()
    # VIOLATION: security/deterministic/ssh-no-host-key-verification
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(host, username=username)
    return client


# ---- ReDoS vulnerable regex ----

import re

# VIOLATION: security/deterministic/redos-vulnerable-regex-python
evil_pattern = re.compile(r"(a+)+b")


# ---- Logging config insecure listen ----

import logging.config

# VIOLATION: security/deterministic/logging-config-insecure-listen
logging.config.listen(9999)
