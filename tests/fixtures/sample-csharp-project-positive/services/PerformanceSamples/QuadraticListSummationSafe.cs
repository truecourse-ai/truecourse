using System.Collections.Generic;

namespace Positive.Boundary.Performance;

/// <summary>Sums latency samples with a numeric accumulator.</summary>
public sealed class QuadraticListSummationSafe
{
    /// <summary>Totals the samples; numeric += is O(n), not string concatenation.</summary>
    internal long TotalLatency(IEnumerable<long> samples)
    {
        long total = 0;
        foreach (var sample in samples)
        {
            // SAFE: performance/deterministic/quadratic-list-summation
            total += sample;
        }

        return total;
    }
}
