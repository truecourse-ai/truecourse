using System.Collections.Generic;
using System.Threading.Tasks;

namespace Positive.Boundary.Reliability;

internal sealed class PromiseAllNoErrorHandlingSafe
{
    internal async Task DrainAsync(IReadOnlyList<Task> pending)
    {
        // SAFE: reliability/deterministic/promise-all-no-error-handling
        await Task.WhenAll(pending);
    }
}
