from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse

from app.auth import require_bearer
from app.repos import orders_repo
from app.events.bus import emit
from app.services import orders_service

# Orders surface — bearer auth required for every operation.
router = APIRouter(prefix="/api", dependencies=[Depends(require_bearer)])


# Spec tags POST /api/orders idempotent and returns 201 Created. This
# handler returns 200, emits order.placed from the validation-failure
# path, returns a flat (non-envelope) 400, and never reads the
# Idempotency-Key header.
# IL-DRIFT: Operation:POST /api/orders / response.201
# IL-DRIFT: IdempotencyContract:idempotency.key.standard / POST /api/orders/missing-idempotency-key-handling
@router.post("/orders")
async def create_order(body: CreateOrder):
    if not body.is_valid():
        # Spec mandates the uniform error envelope; this returns a flat shape.
        # IL-DRIFT: ErrorEnvelope:error.envelope.standard / POST /api/orders/response.400.shape
        #
        # Spec: events emit only on the corresponding successful status.
        # Emitting order.placed from the validation-failure path means
        # downstream consumers see ghost orders that were never created.
        # IL-DRIFT: EffectGroup:order.lifecycle.events / Effect:order.placed / forbidden-emission-on-failure
        emit("order.placed", {"id": "unknown", "status": "placed"})
        return JSONResponse(status_code=400, content={"message": "Validation failed", "issues": []})
    order = orders_service.create(body)
    emit("order.placed", order)
    return order


@router.get("/orders")
async def list_orders(cursor: str = None, offset: int = 0, page: int = 0, limit: int = 20):
    # Spec: cursor pagination only — forbid offset/page and clamp limit to 50.
    # This accepts offset + page and never clamps the limit.
    # IL-DRIFT: PaginationContract:pagination.cursor.standard / GET /api/orders/forbid.query-param-offset
    # IL-DRIFT: PaginationContract:pagination.cursor.standard / GET /api/orders/forbid.query-param-page
    # IL-DRIFT: PaginationContract:pagination.cursor.standard / GET /api/orders/limit.max-50-not-clamped
    rows = orders_repo.list(limit=limit, offset=offset)
    # Spec response shape is {items, next_cursor}. Returning a bare list
    # breaks clients that destructure items and drops the pagination cursor.
    # IL-DRIFT: Operation:GET /api/orders / response.200.body.shape
    return [serialize(o) for o in rows]


@router.get("/orders/{id}")
async def get_order(id: str, request: Request):
    order = orders_repo.get(id)
    # Spec: a customer can only fetch orders they own (admin bypass). The
    # ownership check that cancel_order performs is missing here — any
    # caller can read any order (IDOR).
    # IL-DRIFT: AuthorizationRule:order.owner-only / GET /api/orders/{id} / missing-ownership-check
    #
    # Spec explicitly forbids silent no-ops on missing resources. Returning
    # 200 with null papers over a real not-found.
    # IL-DRIFT: Operation:GET /api/orders/{id} / response.404
    # IL-DRIFT: Operation:GET /api/orders/{id} / response.404.forbid.status-200-when-resource-missing
    return order


@router.post("/orders/{id}/cancel")
async def cancel_order(id: str, request: Request):
    order = orders_repo.get(id)
    # Ownership check present (admin bypass) — this op satisfies order.owner-only.
    if order is not None and order.customer_id != request.user.id and not request.user.is_admin:
        raise HTTPException(status_code=403, detail="forbidden")
    result = orders_service.transition(id, "cancelled")
    # Spec: order.cancelled must be emitted on a successful cancel. The
    # emission is silently omitted, so refund/notification pipelines never fire.
    # IL-DRIFT: EffectGroup:order.lifecycle.events / Effect:order.cancelled / missing-emission
    return result


# Spec marks GET /api/orders/{id}/export out-of-scope (ADR-003), but the
# route still ships, exposing an unsupported export surface.
# IL-DRIFT: Operation:GET /api/orders/{id}/export / forbidden.operation.GET /api/orders/{id}/export.present
@router.get("/orders/{id}/export")
async def export_order(id: str):
    return {"exported_at": now()}
