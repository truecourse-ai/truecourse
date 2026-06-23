using System.Collections.Generic;

namespace Positive.Boundary.CodeQuality;

/// <summary>
/// A multi-word domain string that is already extracted to a named constant and
/// referenced from several places. The literal itself appears once, below the
/// repeat threshold, so the rule must not fire — it only flags 3+ raw repeats.
/// </summary>
public sealed class MagicStringSafe
{
    // SAFE: code-quality/deterministic/magic-string
    private const string DeliveryWindowMissed = "delivery window missed";

    private readonly List<string> _outbox = new();

    /// <summary>Records a missed-delivery alert for each stop.</summary>
    internal void QueueAlerts(IReadOnlyList<string> stops)
    {
        foreach (var stop in stops)
        {
            _outbox.Add($"{stop}: {DeliveryWindowMissed}");
        }
    }

    /// <summary>Returns the queued alert messages.</summary>
    internal IReadOnlyList<string> Drain() => _outbox;
}
