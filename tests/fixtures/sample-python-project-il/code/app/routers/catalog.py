from fastapi import APIRouter, Depends, FastAPI, HTTPException

from app.auth import require_bearer


class CatalogRouter(APIRouter):
    """Thin APIRouter subclass that adds catalog-specific middleware defaults."""
    pass


# FP-GUARD: operation/implementation-missing — must NOT drift
# Routes registered on a custom APIRouter subclass must still be lifted
# with the router's prefix.  Here all catalog endpoints live under
# /catalog; the verifier must recognise CatalogRouter as a router.
router = CatalogRouter(prefix="/catalog", dependencies=[Depends(require_bearer)])


@router.post("/items/search")
async def search_items(body: dict):
    """Full-text search over catalog items."""
    return {"items": [], "total": 0}


@router.get("/items/{item_id}")
async def get_item(item_id: str):
    item = None
    if item is None:
        raise HTTPException(status_code=404, detail="Item not found")
    return item


# FP-GUARD: operation/implementation-missing — must NOT drift
# Route paths supplied as function-parameter defaults (e.g.
# health_path: str = "/health") must be lifted by the verifier even
# though the argument is not a string literal at the call site.
def create_catalog_app(catalog_health_path: str = "/health"):
    app = FastAPI(title="Catalog Service")

    @app.get(catalog_health_path)
    async def catalog_health():
        return {"status": "ok"}

    return app


# Catalog export is processed off-band via the reporting pipeline;
# the REST endpoint the spec requires is not wired in here yet.
# IL-DRIFT: Operation:POST /catalog/export / implementation.missing
