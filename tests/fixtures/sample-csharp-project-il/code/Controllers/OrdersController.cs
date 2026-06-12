using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SampleApi.Data.Entities;
using SampleApi.Domain;
using SampleApi.Events;
using SampleApi.Repositories;
using SampleApi.Services;

namespace SampleApi.Controllers;

// Orders surface — bearer auth required for every operation. The class-level
// [Authorize] mirrors APIRouter(dependencies=[Depends(require_bearer)]); it is
// the positive auth control, so the order operations do NOT drift on auth.
[ApiController]
[Route("api")]
[Authorize]
public class OrdersController : ControllerBase
{
    private readonly OrdersRepository _repo;
    private readonly OrdersService _service;
    private readonly EventBus _bus;

    public OrdersController(OrdersRepository repo, OrdersService service, EventBus bus)
    {
        _repo = repo;
        _service = service;
        _bus = bus;
    }

    // Spec tags POST /api/orders idempotent and returns 201 Created. This handler
    // returns 200, emits order.placed from the validation-failure path, returns a
    // flat (non-envelope) 400, and never reads the Idempotency-Key header.
    // IL-DRIFT: Operation:POST /api/orders / response.201
    // IL-DRIFT: IdempotencyContract:idempotency.key.standard / POST /api/orders/missing-idempotency-key-handling
    [HttpPost("orders")]
    public IActionResult CreateOrder([FromBody] CreateOrder body)
    {
        if (!body.IsValid())
        {
            // Spec mandates the uniform error envelope; this returns a flat shape.
            // IL-DRIFT: ErrorEnvelope:error.envelope.standard / POST /api/orders/response.400.shape
            //
            // Spec: events emit only on the corresponding successful status. Emitting
            // order.placed from the validation-failure path means downstream consumers
            // see ghost orders that were never created.
            // IL-DRIFT: EffectGroup:order.lifecycle.events / Effect:order.placed / forbidden-emission-on-failure
            _bus.Emit("order.placed", new { id = "unknown", status = "placed" });
            return BadRequest(new { message = "Validation failed", issues = Array.Empty<object>() });
        }

        var order = _service.Create(body);
        _bus.Emit("order.placed", order);
        return Ok(order);
    }

    [HttpGet("orders")]
    public IActionResult ListOrders(
        [FromQuery] string? cursor = null,
        [FromQuery] int offset = 0,
        [FromQuery] int page = 0,
        [FromQuery] int limit = 20)
    {
        // Spec: cursor pagination only — forbid offset/page and clamp limit to 50.
        // This accepts offset + page and never clamps the limit.
        // IL-DRIFT: PaginationContract:pagination.cursor.standard / GET /api/orders/forbid.query-param-offset
        // IL-DRIFT: PaginationContract:pagination.cursor.standard / GET /api/orders/forbid.query-param-page
        // IL-DRIFT: PaginationContract:pagination.cursor.standard / GET /api/orders/limit.max-50-not-clamped
        var rows = _repo.List(DateTime.UtcNow.AddDays(-30), DateTime.UtcNow);
        // Spec response shape is {items, next_cursor}. Returning a bare list breaks
        // clients that destructure items and drops the pagination cursor.
        // IL-DRIFT: Operation:GET /api/orders / response.200.body.shape
        return Ok(rows.Select(Serialize).ToList());
    }

    [HttpGet("orders/{id}")]
    public IActionResult GetOrder(Guid id)
    {
        var order = _repo.Get(id);
        // Spec: a customer can only fetch orders they own (admin bypass). The
        // ownership check that CancelOrder performs is missing here — any caller can
        // read any order (IDOR).
        // IL-DRIFT: AuthorizationRule:order.owner-only / GET /api/orders/{id} / missing-ownership-check
        //
        // Spec explicitly forbids silent no-ops on missing resources. Returning 200
        // with null papers over a real not-found.
        // IL-DRIFT: Operation:GET /api/orders/{id} / response.404
        // IL-DRIFT: Operation:GET /api/orders/{id} / response.404.forbid.status-200-when-resource-missing
        return Ok(order);
    }

    [HttpPost("orders/{id}/cancel")]
    public IActionResult CancelOrder(Guid id)
    {
        var order = _repo.Get(id);
        // Ownership check present (admin bypass) — this op satisfies order.owner-only.
        if (order is not null && order.CustomerId != CurrentUserId() && !User.IsInRole("admin"))
        {
            return StatusCode(403, new { error = new { code = "forbidden", message = "Forbidden" } });
        }

        var result = _service.Transition(order!, "cancelled");
        // Spec: order.cancelled must be emitted on a successful cancel. The emission
        // is silently omitted, so refund/notification pipelines never fire.
        // IL-DRIFT: EffectGroup:order.lifecycle.events / Effect:order.cancelled / missing-emission
        return Ok(result);
    }

    // Spec marks GET /api/orders/{id}/export out-of-scope (ADR-003), but the route
    // still ships, exposing an unsupported export surface.
    // IL-DRIFT: Operation:GET /api/orders/{id}/export / forbidden.operation.GET /api/orders/{id}/export.present
    [HttpGet("orders/{id}/export")]
    public IActionResult ExportOrder(Guid id)
    {
        return Ok(new { exported_at = DateTime.UtcNow.ToString("o") });
    }

    private Guid CurrentUserId() => Guid.Parse(User.FindFirst("sub")?.Value ?? Guid.Empty.ToString());

    private static object Serialize(Order order) => new { id = order.Id, status = order.Status };
}
