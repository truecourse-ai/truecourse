"""FastAPI-based API routes with various violations."""
import os
import logging
from typing import Optional, Dict, List, Any
from functools import lru_cache

from fastapi import FastAPI, APIRouter, Depends, Query, HTTPException, Response
from fastapi.testclient import TestClient
from pydantic import BaseModel

logger = logging.getLogger(__name__)

app = FastAPI()
router = APIRouter()


# VIOLATION: code-quality/deterministic/fastapi-router-prefix
items_router = APIRouter()
app.include_router(items_router, prefix="/items")


# VIOLATION: code-quality/deterministic/pydantic-optional-default
class ItemCreate(BaseModel):
    name: str
    description: Optional[str]
    category: Optional[str]


class ItemResponse(BaseModel):
    id: int
    name: str
    status: str


# VIOLATION: code-quality/deterministic/fastapi-generic-route-decorator
@app.api_route("/api/items")
async def list_items():
    return {"items": []}


# VIOLATION: code-quality/deterministic/fastapi-non-annotated-dependency
@app.get("/api/items/{item_id}")
async def get_item(item_id: int, db=Depends(lambda: None)):
    return {"id": item_id}


# VIOLATION: code-quality/deterministic/fastapi-undocumented-exception
@app.get("/api/items/{item_id}/details", response_model=ItemResponse)
async def get_item_details(item_id: int):
    raise HTTPException(status_code=404, detail="Item not found")


# VIOLATION: code-quality/deterministic/fastapi-testclient-content
def test_list_items():
    client = TestClient(app)
    response = client.post("/api/items", data=b'{"name": "test"}')
    return response.json()


# VIOLATION: code-quality/deterministic/fastapi-import-string
import uvicorn

def start_server():
    uvicorn.run(app, reload=True)


# --- Flask violations ---

from flask import Flask, request as flask_request

flask_app = Flask(__name__)


# VIOLATION: code-quality/deterministic/flask-rest-verb-annotation
@flask_app.route("/api/users")
def list_users():
    return {"users": []}


# --- Pytest violations ---

import pytest


# VIOLATION: code-quality/deterministic/pytest-assert-in-except
def test_exception_handling():
    try:
        raise ValueError("test")
    except ValueError as e:
        assert str(e) == "test"


# VIOLATION: code-quality/deterministic/pytest-composite-assertion
def test_item_properties():
    item = {"name": "test", "active": True}
    assert item["name"] == "test" and item["active"] is True


# VIOLATION: code-quality/deterministic/pytest-duplicate-parametrize
@pytest.mark.parametrize("value", [1, 2, 3, 2, 4])
def test_process_value(value):
    assert value > 0


# VIOLATION: code-quality/deterministic/pytest-fail-without-message
def test_not_implemented():
    pytest.fail()


# VIOLATION: code-quality/deterministic/pytest-raises-multiple-statements
def test_validation_error():
    with pytest.raises(ValueError):
        data = {"key": "value"}
        validate_data(data)
        process_result(data)


def validate_data(data):
    if "required_field" not in data:
        raise ValueError("Missing required field")


def process_result(data):
    return data


# VIOLATION: code-quality/deterministic/pytest-unittest-assertion
class TestItemService:
    def test_create_item(self):
        result = {"status": "created"}
        self.assertEqual(result["status"], "created")


# VIOLATION: code-quality/deterministic/pytest-warns-issues
def test_deprecation_warning():
    with pytest.warns():
        import warnings
        warnings.warn("deprecated", DeprecationWarning)


# VIOLATION: code-quality/deterministic/pytest-suboptimal-pattern
@pytest.yield_fixture
def db_session():
    session = create_session()
    yield session
    session.close()


def create_session():
    return {}


# VIOLATION: code-quality/deterministic/test-not-discoverable
class ItemTests:
    def create_item(self):
        assert True


# VIOLATION: code-quality/deterministic/test-skipped-implicitly
@pytest.mark.skip
def test_skipped_without_reason():
    assert True


# VIOLATION: code-quality/deterministic/unittest-specific-assertion
import unittest


class TestAdminEndpoints(unittest.TestCase):
    def test_admin_access(self):
        result = 5
        self.assertTrue(result == 5)


# --- Pyupgrade violations ---

# VIOLATION: code-quality/deterministic/pyupgrade-modernization
@lru_cache()
def get_config():
    return {"debug": False}
