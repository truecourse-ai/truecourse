using System.Threading;
using System.Threading.Tasks;

namespace ApiGateway.Violations.Architecture;

/// <summary>
/// The concrete order-creation handler at the bottom of the handler pipeline. It derives
/// through six project-defined base classes, so its effective behavior is spread across
/// the whole inheritance tower.
/// </summary>
// VIOLATION: architecture/deterministic/deep-inheritance-chain
public sealed class CreateOrderHandler : ValidationHandler
{
    /// <inheritdoc />
    public override async Task<int> InvokeAsync(string payload, CancellationToken ct)
    {
        LogEntry(payload);
        if (!IsAuthenticated(payload) || !IsAuthorized(payload) || !IsValid(payload))
            return 400;
        await Task.Yield();
        RecordLatency(0);
        return 201;
    }
}
