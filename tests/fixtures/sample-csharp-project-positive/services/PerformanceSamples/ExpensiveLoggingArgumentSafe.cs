using System.Collections.Generic;
using Microsoft.Extensions.Logging;

namespace Positive.Boundary.Performance;

/// <summary>Traces reconciled ledger rows behind a level guard.</summary>
public sealed class ExpensiveLoggingArgumentSafe
{
    private readonly ILogger<ExpensiveLoggingArgumentSafe> _logger;

    /// <summary>Creates the tracer over the given logger.</summary>
    public ExpensiveLoggingArgumentSafe(ILogger<ExpensiveLoggingArgumentSafe> logger)
    {
        _logger = logger;
    }

    /// <summary>Traces every row reconciled in this batch.</summary>
    internal void TraceBatch(IReadOnlyList<LedgerRow> rows)
    {
        if (_logger.IsEnabled(LogLevel.Debug))
        {
            foreach (var row in rows)
            {
                // SAFE: performance/deterministic/expensive-logging-argument
                _logger.LogDebug("Reconciled row {Summary}", BuildSummary(row));
            }
        }
    }

    private static string BuildSummary(LedgerRow row) => $"{row.Account}:{row.Cents}";
}

/// <summary>A single posted ledger row.</summary>
internal sealed record LedgerRow(string Account, long Cents);
