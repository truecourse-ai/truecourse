using System.Collections.Generic;
using Microsoft.Extensions.Logging;

namespace UserServiceApp.Violations.Performance;

/// <summary>
/// Emits a per-row debug trace while reconciling a batch of ledger rows. Each debug
/// line formats its argument by calling BuildSummary, which runs on every row even
/// when Debug logging is switched off in production — so the formatting is wasted work
/// on the reconciliation hot path.
/// </summary>
internal sealed class ReconciliationTracer
{
    private readonly ILogger<ReconciliationTracer> _logger;

    public ReconciliationTracer(ILogger<ReconciliationTracer> logger)
    {
        _logger = logger;
    }

    /// <summary>Traces every row reconciled in this batch.</summary>
    public void TraceBatch(IReadOnlyList<LedgerRow> rows)
    {
        foreach (var row in rows)
        {
            // VIOLATION: performance/deterministic/expensive-logging-argument
            _logger.LogDebug("Reconciled row {Summary}", BuildSummary(row));
        }
    }

    private static string BuildSummary(LedgerRow row) => $"{row.Account}:{row.Cents}";
}

/// <summary>A single posted ledger row.</summary>
internal sealed record LedgerRow(string Account, long Cents);
