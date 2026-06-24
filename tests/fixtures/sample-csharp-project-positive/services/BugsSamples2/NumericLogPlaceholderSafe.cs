using Microsoft.Extensions.Logging;

namespace Positive.Boundary.Bugs;

/// <summary>Logs completion events using named structured placeholders.</summary>
public sealed class NumericLogPlaceholderSafe
{
    private readonly ILogger<NumericLogPlaceholderSafe> _log;

    /// <summary>Creates the logger wrapper.</summary>
    public NumericLogPlaceholderSafe(ILogger<NumericLogPlaceholderSafe> log)
    {
        _log = log;
    }

    /// <summary>Records that a request completed.</summary>
    internal void Completed(int requestId)
    {
        // SAFE: bugs/deterministic/numeric-log-placeholder
        _log.LogInformation("Request {RequestId} completed", requestId);
    }
}
