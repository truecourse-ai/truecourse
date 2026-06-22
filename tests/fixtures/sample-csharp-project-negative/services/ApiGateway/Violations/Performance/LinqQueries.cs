using System.Linq;
using System.Threading.Tasks;

namespace ApiGateway.Violations.Performance;

internal sealed class LinqQueries
{
    internal List<Order> LargeOrdersSorted(List<Order> orders, decimal threshold)
    {
        // VIOLATION: performance/deterministic/filter-before-sort
        return orders.OrderBy(o => o.PlacedAt).Where(o => o.Total > threshold).ToList();
    }

    internal async Task<bool> AnyPendingAsync(IOrderQuery query)
    {
        // VIOLATION: performance/deterministic/countasync-instead-of-anyasync
        return await query.PendingOrders().CountAsync() != 0;
    }

    internal bool ContainsRegion(List<string> regions, string region)
    {
        // VIOLATION: performance/deterministic/prefer-contains-over-any
        return regions.Any(r => r == region);
    }
}

internal sealed class Order
{
    public string Region { get; init; } = "";
    public System.DateTime PlacedAt { get; init; }
    public decimal Total { get; init; }
}

internal interface IOrderQuery
{
    IQueryable<Order> PendingOrders();
}
