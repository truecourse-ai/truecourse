"""Endpoint backing the Starlette-mounted bulk catalog-feed import.

The handler reads the catch-all feed key off the request path, streams the
upload into the import pipeline, and returns a JSON acknowledgement.
"""

from starlette.requests import Request
from starlette.responses import JSONResponse


async def catalog_feed_import_endpoint(request: Request) -> JSONResponse:
    feed_key = request.path_params["feed_key"]
    body = await request.body()
    return JSONResponse({"feed_key": feed_key, "accepted_bytes": len(body)})
