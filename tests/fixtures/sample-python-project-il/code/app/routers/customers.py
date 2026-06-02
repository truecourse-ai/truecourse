from fastapi import APIRouter, HTTPException

from app.repos import customers_repo
from app.services import customers_service
from app.repos import loyalty_repo

# Spec: every endpoint under /api/* requires a Bearer token, and POST
# /api/customers additionally requires the admin role. This router mounts
# WITHOUT any auth dependency, so all three operations are reachable
# anonymously.
# IL-DRIFT: AuthRequirement:auth.bearer.api / POST /api/customers/unprotected
# IL-DRIFT: AuthRequirement:auth.bearer.api / GET /api/customers/unprotected
# IL-DRIFT: AuthRequirement:auth.bearer.api / GET /api/customers/{id}/unprotected
# IL-DRIFT: AuthRequirement:auth.role.admin / POST /api/customers/unprotected
router = APIRouter(prefix="/api")


@router.post("/customers", status_code=201)
async def create_customer(body: CreateCustomer):
    customer = customers_service.create_customer(body.email, body.name)
    return customer


@router.get("/customers")
async def list_customers(cursor: str = None, limit: int = 20):
    page = customers_repo.list(limit=min(limit, 50))
    return {"items": page, "next_cursor": None}


@router.get("/customers/{id}")
async def get_customer(id: str):
    c = customers_repo.get(id)
    if c is None:
        raise HTTPException(
            status_code=404,
            detail={"error": {"code": "customer_not_found", "message": "Customer does not exist"}},
        )
    return c


@router.get("/loyalty-tiers")
async def list_loyalty_tiers():
    return loyalty_repo.list_eligible_tiers(None, "is_active = true")
