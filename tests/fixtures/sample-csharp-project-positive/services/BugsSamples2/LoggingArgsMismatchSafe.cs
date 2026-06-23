using Microsoft.Extensions.Logging;

namespace Positive.Boundary.Bugs;

/// <summary>Logs load progress with one argument per template placeholder.</summary>
public sealed class LoggingArgsMismatchSafe
{
    private readonly ILogger<LoggingArgsMismatchSafe> _logger;

    /// <summary>Creates the service over the given logger.</summary>
    public LoggingArgsMismatchSafe(ILogger<LoggingArgsMismatchSafe> logger)
    {
        _logger = logger;
    }

    /// <summary>Reports how many records were loaded for a user.</summary>
    internal void ReportLoaded(int count, string user)
    {
        // SAFE: bugs/deterministic/logging-args-mismatch
        _logger.LogInformation("Loaded {Count} records for {User}", count, user);
    }
}
