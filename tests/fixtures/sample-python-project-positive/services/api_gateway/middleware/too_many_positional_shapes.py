"""too-many-positional-arguments shape that should NOT fire.

FastAPI / Starlette route handlers receive parameters via
``Annotated[T, Query(...)]`` / ``Annotated[T, Body(...)]`` /
``Annotated[T, Depends(...)]``, which are passed by name by the
framework — they are keyword-only at the call site, even though
they are syntactically positional in Python.
"""

from typing import Annotated, Optional
from fastapi import APIRouter, Query, Depends, Header

router = APIRouter()


def get_db() -> object:
    """Provide a request-scoped database handle."""
    return object()


@router.get("/search")
def search(
    q: Annotated[str, Query(description="Search query")],
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
    sort: Annotated[Optional[str], Query()] = None,
    user_agent: Annotated[Optional[str], Header()] = None,
    locale: Annotated[Optional[str], Header()] = None,
    db: Annotated[Optional[object], Depends(get_db)] = None,
) -> dict:
    """Return search results — every param is supplied by FastAPI by name."""
    return {"q": q, "page": page, "page_size": page_size, "sort": sort,
            "user_agent": user_agent, "locale": locale, "db": db}
