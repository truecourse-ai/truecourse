using Api.Models;
using Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Api.Controllers;

/// <summary>HTTP surface for order workflows.</summary>
[ApiController]
[Authorize]
[Route("api/[controller]")]
public class OrdersController : ControllerBase
{
    private readonly IOrderService _orderService;

    /// <summary>Creates the controller with the order service.</summary>
    public OrdersController(IOrderService orderService)
    {
        _orderService = orderService;
    }

    /// <summary>Returns one order, or 404 when absent.</summary>
    [HttpGet("{id:guid}")]
    [ProducesResponseType(typeof(Order), 200)]
    [ProducesResponseType(404)]
    public async Task<IActionResult> Get(Guid id, CancellationToken cancellationToken)
    {
        var order = await _orderService.GetAsync(id, cancellationToken);
        if (order is null)
        {
            return NotFound();
        }
        return Ok(order);
    }

    /// <summary>Places a new order for the given customer.</summary>
    [HttpPost]
    [ProducesResponseType(typeof(Order), 201)]
    public async Task<IActionResult> Place([FromBody] PlaceOrderRequest request, CancellationToken cancellationToken)
    {
        var order = await _orderService.PlaceAsync(request.CustomerId, request.Lines, cancellationToken);
        return CreatedAtAction(nameof(Get), new { id = order.Id }, order);
    }

    /// <summary>Ships a paid order; 409 when it is not in a shippable state.</summary>
    [HttpPost("{id:guid}/ship")]
    [ProducesResponseType(204)]
    [ProducesResponseType(409)]
    public async Task<IActionResult> Ship(Guid id, CancellationToken cancellationToken)
    {
        var shipped = await _orderService.ShipAsync(id, cancellationToken);
        if (!shipped)
        {
            return Conflict(new { error = "Order is not in a shippable state." });
        }
        return NoContent();
    }
}

/// <summary>Request body for placing an order.</summary>
/// <param name="CustomerId">Customer placing the order.</param>
/// <param name="Lines">Lines to include.</param>
public record PlaceOrderRequest(Guid CustomerId, List<OrderLine> Lines);
