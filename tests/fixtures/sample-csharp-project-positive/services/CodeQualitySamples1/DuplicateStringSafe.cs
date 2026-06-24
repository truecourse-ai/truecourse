using System.Collections.Generic;

namespace Positive.Boundary.CodeQuality;

/// <summary>
/// The repeated phrase is referenced through a single named constant rather
/// than being written as a literal three or more times, so the
/// duplicate-string rule must not fire.
/// </summary>
public class DuplicateStringSafe
{
    private const string MissedWindow = "delivery window missed";

    private readonly List<string> _outbox = new();

    /// <summary>Records a missed-window incident for each stop.</summary>
    public void QueueDeliveryAlerts(IEnumerable<string> stops)
    {
        foreach (var stop in stops)
        {
            // SAFE: code-quality/deterministic/duplicate-string
            _outbox.Add(MissedWindow);
            _outbox.Add($"{stop}: {MissedWindow}");
        }
    }
}
