using System.Collections.Generic;
using System.Linq;

namespace Positive.Boundary.Bugs;

/// <summary>Totals integer latencies while keeping the overflow check intact.</summary>
public sealed class UncheckedEnumerableSumOverflowSafe
{
    /// <summary>Sums in a checked context, so the rule (which targets unchecked) must not fire.</summary>
    internal int TotalLatency(List<int> latencies)
    {
        checked
        {
            // SAFE: bugs/deterministic/unchecked-enumerable-sum-overflow
            return latencies.Sum();
        }
    }
}
