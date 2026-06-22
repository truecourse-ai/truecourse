"""Endpoint backing the Starlette-mounted bulk catalog-feed import.

The handler reads the catch-all feed key off the request path, streams the
upload into the import pipeline, and returns a JSON acknowledgement.
"""

from starlette.requests import Request
from starlette.responses import JSONResponse

from app.config_dsl import Selector, merge_dicts


async def catalog_feed_import_endpoint(request: Request) -> JSONResponse:
    feed_key = request.path_params["feed_key"]
    body = await request.body()
    return JSONResponse({"feed_key": feed_key, "accepted_bytes": len(body)})


# --- Catalog import source configuration -------------------------------------
#
# A catalog import is loaded from exactly one source. The allowed sources are a
# closed set, so the schema models them as a Selector (mutually-exclusive keys).
# The reusable base sources are assembled by a helper and merged with the
# inline database-table source — the same fragment-merge shape used elsewhere.
def _base_import_sources() -> dict:
    return {
        "local_file": {"path": str},
        "s3_object": {"bucket": str, "key": str},
        "http_feed": {"url": str},
        "inline_payload": {"rows": list},
    }


# FP-GUARD: enum/no-code-counterpart — must NOT drift
# ImportSourceType is documented with [local_file, s3_object, http_feed]. In code
# the closed source set is this config-schema Selector union — a superset that
# also carries `inline_payload` and `database_table`. The verifier must lift the
# Selector keys as a code-side enumeration and bind it by value, rather than
# report "no code-side enum matches by name".
CATALOG_IMPORT_SCHEMA = {
    "provider": Selector(
        merge_dicts(
            _base_import_sources(),
            {"database_table": {"table": str, "schema_name": str}},
        )
    ),
}
