"""Reliability patterns with various issues."""
import os
import asyncio
import aiohttp
from flask import Flask, jsonify
from django.contrib.auth.decorators import login_required
from django.views.decorators.http import require_http_methods


# ---- Async resource without async with ----

async def fetch_all_urls(urls: list) -> list:
    """Fetch multiple URLs without proper async resource management."""
    results = []
    # VIOLATION: reliability/deterministic/async-with-for-resources
    session = aiohttp.AsyncClient()
    for url in urls:
        resp = await session.get(url)
        results.append(await resp.json())
    return results


# ---- Django decorator order ----

# VIOLATION: reliability/deterministic/django-decorator-order
@login_required
@require_http_methods(["GET", "POST"])
def user_profile(request):
    """View user profile with incorrect decorator ordering."""
    return {"user": request.user.username}


# ---- Flask error handler missing status code ----

app = Flask(__name__)


# VIOLATION: reliability/deterministic/flask-error-handler-missing-status
@app.errorhandler(404)
def not_found_handler(error):
    """Handle 404 errors without returning status code."""
    return jsonify({"error": "Resource not found"})


# ---- Invalid envvar default ----

def get_config():
    """Load configuration from environment with wrong default types."""
    # VIOLATION: reliability/deterministic/invalid-envvar-default
    port = os.getenv("PORT", 8080)
    # VIOLATION: reliability/deterministic/invalid-envvar-default
    debug = os.getenv("DEBUG", False)
    return {"port": port, "debug": debug}
