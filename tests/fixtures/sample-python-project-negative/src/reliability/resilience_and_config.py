"""Reliability violations: error handling, HTTP, config, and resource management."""
import os
import sys
import json
import requests
from flask import Flask, jsonify


# VIOLATION: reliability/deterministic/unsafe-json-parse
def parse_response(raw):
    return json.loads(raw)


# VIOLATION: reliability/deterministic/http-call-no-timeout
def fetch_data():
    return requests.get("https://api.example.com/data")


# VIOLATION: reliability/deterministic/http-call-no-timeout
def post_data(payload):
    return requests.post("https://api.example.com/submit", json=payload)


# VIOLATION: reliability/deterministic/process-exit-in-library
def handle_error():
    sys.exit(1)


# VIOLATION: reliability/deterministic/shallow-copy-environ
env = os.environ


# VIOLATION: reliability/deterministic/invalid-envvar-default
port = os.getenv("PORT", 8080)


# VIOLATION: reliability/deterministic/invalid-envvar-default
debug = os.getenv("DEBUG", False)


app = Flask(__name__)


# VIOLATION: reliability/deterministic/flask-error-handler-missing-status
@app.errorhandler(404)
def not_found(error):
    return jsonify({"error": "not found"})


# VIOLATION: reliability/deterministic/async-with-for-resources
import httpx

async def fetch_async():
    client = httpx.AsyncClient()
    resp = await client.get("https://api.example.com")
    return resp


# VIOLATION: reliability/deterministic/django-decorator-order
from django.contrib.auth.decorators import login_required
from django.views.decorators.http import require_POST

@login_required
@require_POST
def submit_form(request):
    return {"ok": True}
