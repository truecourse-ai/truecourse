from starlette.applications import Starlette
from starlette.routing import Route

from app.services.imports_service import catalog_feed_import_endpoint


# FP-GUARD: operation/implementation-missing — must NOT drift
# The bulk catalog-feed import is mounted as a Starlette sub-app using the
# Route([...]) list form instead of a FastAPI decorator.  The feed key is
# supplied as a trailing catch-all path segment (`{feed_key:path}`), so the
# documented endpoint is the static prefix `/imports/catalog_feed/`.  The
# verifier must lift this list-style route, normalise the catch-all tail, and
# recognise the POST endpoint as implemented.
routes = [
    Route(
        "/imports/catalog_feed/{feed_key:path}",
        catalog_feed_import_endpoint,
        methods=["POST"],
    ),
]


# Inventory reconciliation runs entirely inside the nightly batch worker and is
# never exposed over HTTP, so the REST endpoint the spec documents has no
# Starlette route here — a genuine missing implementation.
# IL-DRIFT: Operation:POST /imports/inventory_sync/ / implementation.missing


imports_app = Starlette(routes=routes)
