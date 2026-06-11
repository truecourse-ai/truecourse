using Api.Clients;
using Api.Models;
using Api.Repositories;

namespace Api.Services;

/// <summary>Order workflows above the repository.</summary>
public interface IOrderService
{
    /// <summary>Loads one order, or null when absent.</summary>
    Task<Order?> GetAsync(Guid id, CancellationToken cancellationToken);

    /// <summary>Places a new pending order.</summary>
    Task<Order> PlaceAsync(Guid customerId, IReadOnlyList<OrderLine> lines, CancellationToken cancellationToken);

    /// <summary>Marks an order shipped and notifies the carrier.</summary>
    Task<bool> ShipAsync(Guid id, CancellationToken cancellationToken);
}

/// <summary>Default implementation of <see cref="IOrderService"/>.</summary>
public class OrderService : IOrderService
{
    private readonly IOrderRepository _orders;
    private readonly ShippingClient _shipping;
    private readonly ILogger<OrderService> _logger;

    /// <summary>Creates the service with its collaborators.</summary>
    public OrderService(IOrderRepository orders, ShippingClient shipping, ILogger<OrderService> logger)
    {
        _orders = orders;
        _shipping = shipping;
        _logger = logger;
    }

    /// <inheritdoc />
    public Task<Order?> GetAsync(Guid id, CancellationToken cancellationToken)
    {
        return _orders.FindAsync(id, cancellationToken);
    }

    /// <inheritdoc />
    public async Task<Order> PlaceAsync(Guid customerId, IReadOnlyList<OrderLine> lines, CancellationToken cancellationToken)
    {
        var order = new Order
        {
            Id = Guid.NewGuid(),
            CustomerId = customerId,
            Status = OrderStatus.Pending,
            TotalCents = lines.Sum(line => line.UnitPriceCents * line.Quantity),
            CreatedAtUtc = DateTime.UtcNow,
            Lines = lines.ToList(),
        };

        await _orders.SaveAsync(order, cancellationToken);
        _logger.LogInformation("Order {OrderId} placed for customer {CustomerId}", order.Id, order.CustomerId);
        return order;
    }

    /// <inheritdoc />
    public async Task<bool> ShipAsync(Guid id, CancellationToken cancellationToken)
    {
        var order = await _orders.FindAsync(id, cancellationToken);
        if (order is null || order.Status != OrderStatus.Paid)
        {
            return false;
        }

        var accepted = await _shipping.RequestPickupAsync(order.Id, cancellationToken);
        if (!accepted)
        {
            _logger.LogWarning("Carrier rejected pickup for order {OrderId}", order.Id);
            return false;
        }

        order.Status = OrderStatus.Shipped;
        await _orders.SaveAsync(order, cancellationToken);
        return true;
    }
}
