using Microsoft.Extensions.Logging;

namespace Positive.Boundary.Bugs;

/// <summary>Logs request lifecycle events with constant structured templates.</summary>
public sealed class NonStaticLogTemplateSafe
{
    private readonly ILogger<NonStaticLogTemplateSafe> _log;

    /// <summary>Creates the logger wrapper.</summary>
    public NonStaticLogTemplateSafe(ILogger<NonStaticLogTemplateSafe> log)
    {
        _log = log;
    }

    /// <summary>Records that a request started.</summary>
    internal void Started(int requestId)
    {
        // SAFE: bugs/deterministic/non-static-log-template
        _log.LogInformation("Request {RequestId} started", requestId);
    }
}
