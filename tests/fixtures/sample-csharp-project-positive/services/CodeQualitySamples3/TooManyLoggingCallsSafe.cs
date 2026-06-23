using Microsoft.Extensions.Logging;

namespace Positive.Boundary.CodeQuality;

/// <summary>Runs a migration step while emitting a bounded set of progress logs.</summary>
public sealed class TooManyLoggingCallsSafe
{
    private readonly ILogger<TooManyLoggingCallsSafe> _logger;

    /// <summary>Creates the migration runner with the supplied logger.</summary>
    public TooManyLoggingCallsSafe(ILogger<TooManyLoggingCallsSafe> logger)
    {
        _logger = logger;
    }

    /// <summary>Migrates a batch, logging the seven canonical lifecycle events.</summary>
    internal void Migrate(string batchId)
    {
        // SAFE: code-quality/deterministic/too-many-logging-calls
        _logger.LogInformation("Starting migration for {Batch}", batchId);
        _logger.LogDebug("Acquiring lock for {Batch}", batchId);
        _logger.LogInformation("Lock acquired for {Batch}", batchId);
        _logger.LogDebug("Applying schema changes for {Batch}", batchId);
        _logger.LogInformation("Schema applied for {Batch}", batchId);
        _logger.LogDebug("Releasing lock for {Batch}", batchId);
        _logger.LogInformation("Migration complete for {Batch}", batchId);
    }
}
