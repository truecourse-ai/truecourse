using Microsoft.Extensions.Logging;

namespace Positive.Boundary.Bugs;

/// <summary>Emits a structured log entry using a message template, not interpolation.</summary>
public sealed class MissingFstringSyntaxSafe
{
    private readonly ILogger _logger;

    /// <summary>Wraps the logger used for queue diagnostics.</summary>
    public MissingFstringSyntaxSafe(ILogger logger)
    {
        _logger = logger;
    }

    /// <summary>Records the current queue depth for a tenant.</summary>
    public void RecordDepth(int depth, string tenant)
    {
        // SAFE: bugs/deterministic/missing-fstring-syntax
        _logger.LogInformation("queue depth {Depth} for tenant {Tenant}", depth, tenant);
    }
}
