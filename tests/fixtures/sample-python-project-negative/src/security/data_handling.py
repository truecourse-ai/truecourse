"""Security violations: data handling, serialization, and file operations."""
import os
import pickle
import yaml
import tempfile
import zipfile
import logging
import xml.etree.ElementTree as ET
import torch


# VIOLATION: security/deterministic/unsafe-yaml-load
data = yaml.load(open("config.yml"))


# VIOLATION: security/deterministic/unsafe-pickle-usage
obj = pickle.loads(untrusted_data)


# VIOLATION: security/deterministic/unsafe-torch-load
model = torch.load("model.pth")


# VIOLATION: security/deterministic/xml-xxe
tree = ET.parse("data.xml")


# VIOLATION: security/deterministic/unsafe-unzip
with zipfile.ZipFile("archive.zip") as zip_archive:
    zip_archive.extractall("/tmp/output")


# VIOLATION: security/deterministic/unsafe-temp-file
tmpname = tempfile.mktemp()


# VIOLATION: security/deterministic/file-permissions-world-accessible
os.chmod("/tmp/data.txt", 0o777)


# VIOLATION: security/deterministic/non-octal-file-permissions
os.chmod("/tmp/data.txt", 511)


# VIOLATION: security/deterministic/insecure-cookie
from flask import Flask, make_response
app = Flask(__name__)

@app.route("/login")
def login():
    resp = make_response("logged in")
    # VIOLATION: security/deterministic/insecure-cookie
    resp.set_cookie("session", "abc123")
    return resp


# VIOLATION: security/deterministic/cookie-without-httponly
@app.route("/login2")
def login2():
    resp = make_response("logged in")
    resp.set_cookie("session", "abc123", secure=True)
    return resp


# VIOLATION: security/deterministic/disabled-auto-escaping
from jinja2 import Environment
env = Environment(autoescape=False)


# VIOLATION: security/deterministic/confidential-info-logging
def log_creds(password):
    logging.info("Password: %s", password)


# VIOLATION: security/deterministic/production-debug-enabled
DEBUG = True


# VIOLATION: security/deterministic/unsafe-markup
from markupsafe import Markup
html = Markup(user_input)


# VIOLATION: security/deterministic/logging-config-insecure-listen
import logging.config
logging.config.listen(9030)


# VIOLATION: security/deterministic/paramiko-call
import paramiko
client = paramiko.SSHClient()
client.connect("host", username="root", password="pass")


# VIOLATION: security/deterministic/suspicious-url-open
import urllib.request
urllib.request.urlopen(user_provided_url)


# VIOLATION: security/deterministic/redos-vulnerable-regex-python
import re
pattern = re.compile(r"(a+)+$")


# VIOLATION: security/deterministic/vulnerable-library-import
import telnetlib


# VIOLATION: security/deterministic/ssh-no-host-key-verification
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())


# VIOLATION: security/deterministic/fastapi-file-upload-body
from fastapi import FastAPI, File, UploadFile
app2 = FastAPI()

@app2.post("/upload")
async def upload(file: UploadFile):
    return {"name": file.filename}


# VIOLATION: security/deterministic/snmp-insecure-version
from pysnmp.hlapi import CommunityData
community = CommunityData("public", mpModel=0)
