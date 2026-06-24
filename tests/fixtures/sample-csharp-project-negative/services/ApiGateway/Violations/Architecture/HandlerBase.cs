using System.Threading;
using System.Threading.Tasks;

namespace ApiGateway.Violations.Architecture;

/// <summary>
/// A home-grown request-handling pipeline built as a tower of inheritance. Each layer
/// adds one cross-cutting concern by subclassing the layer below it, so the concrete
/// handler at the bottom (see <see cref="CreateOrderHandler"/>) sits many levels deep in
/// a single project-authored chain.
/// </summary>
public abstract class HandlerBase
{
    /// <summary>Processes the request payload and returns a status code.</summary>
    public abstract Task<int> InvokeAsync(string payload, CancellationToken ct);
}

/// <summary>Adds request/response logging to the pipeline.</summary>
public class LoggingHandler : HandlerBase
{
    /// <summary>Records that a request entered the pipeline.</summary>
    protected void LogEntry(string payload) => System.Diagnostics.Trace.WriteLine(payload);

    /// <inheritdoc />
    public override Task<int> InvokeAsync(string payload, CancellationToken ct) => Task.FromResult(200);
}

/// <summary>Adds latency and throughput metrics on top of logging.</summary>
public class MetricsHandler : LoggingHandler
{
    /// <summary>Records the observed request latency in milliseconds.</summary>
    protected void RecordLatency(long ms) => System.Diagnostics.Trace.WriteLine(ms);
}
