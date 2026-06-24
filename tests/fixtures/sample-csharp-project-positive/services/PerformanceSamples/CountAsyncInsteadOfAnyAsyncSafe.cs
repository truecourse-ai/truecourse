using System.Linq;
using System.Threading.Tasks;

namespace Positive.Boundary.Performance;

/// <summary>Checks for pending orders with a short-circuiting existence query.</summary>
public sealed class CountAsyncInsteadOfAnyAsyncSafe
{
    /// <summary>True when at least one pending order exists.</summary>
    internal async Task<bool> AnyPendingAsync(IOrderQuery query)
    {
        // SAFE: performance/deterministic/countasync-instead-of-anyasync
        return await query.PendingOrders().AnyAsync();
    }
}

/// <summary>Read side for orders.</summary>
internal interface IOrderQuery
{
    /// <summary>The currently pending orders.</summary>
    IQueryable<int> PendingOrders();
}
