using SampleApi.Data.Entities;
using SampleApi.Domain;

namespace SampleApi.Services;

public class OrdersService
{
    private static DateTime Now() => DateTime.UtcNow;

    private static readonly Dictionary<string, string[]> Allowed = new()
    {
        ["placed"] = new[] { "paid", "cancelled" },
        ["paid"] = new[] { "shipped", "cancelled" },
        // Spec says shipped only transitions to delivered. Allowing cancelled
        // here means a shipped order can be silently rolled back, which the
        // accounting and warehouse consumers don't expect.
        // IL-DRIFT: StateMachine:Order.status / transition.illegal.shipped-to-cancelled
        ["shipped"] = new[] { "delivered", "cancelled" },
        ["delivered"] = Array.Empty<string>(),
        ["cancelled"] = Array.Empty<string>(),
    };

    public Order Create(CreateOrder body)
    {
        // Server-assigned fields are set once, at construction.
        return new Order
        {
            Id = Guid.NewGuid(),
            Status = "placed",
            SubtotalCents = body.SubtotalCents,
            CustomerId = body.CustomerId,
            PlacedAt = Now(),
            CreatedAt = Now(),
            UpdatedAt = Now(),
        };
    }

    public Order? Transition(Order order, string target)
    {
        if (!Allowed[order.Status].Contains(target))
        {
            return null;
        }

        // Spec marks placed_at immutable after creation. Refreshing it on every
        // transition destroys the original placement timestamp.
        // IL-DRIFT: Entity:Order / field.placed_at.mutability
        order.PlacedAt = Now();
        order.Status = target;
        order.UpdatedAt = Now();
        return order;
    }

    public void RecoverExpired(Order order)
    {
        // No guard on current status. A delivered or cancelled order (both
        // terminal) gets dragged back into 'paid', re-running completed work.
        // IL-DRIFT: StateMachine:Order.status / transition.unguarded-terminal-regression.to-paid
        order.Status = "paid";
        order.UpdatedAt = Now();
    }
}
