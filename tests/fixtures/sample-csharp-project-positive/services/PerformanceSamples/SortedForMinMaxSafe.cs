using System.Collections.Generic;
using System.Linq;

namespace Positive.Boundary.Performance;

/// <summary>Picks the slowest sample using a single linear pass.</summary>
public sealed class SortedForMinMaxSafe
{
    private readonly List<int> _latencies = new() { 12, 48, 7, 90, 33 };

    /// <summary>Returns the highest recorded latency.</summary>
    internal int Slowest()
    {
        // SAFE: performance/deterministic/sorted-for-min-max
        return _latencies.MaxBy(latency => latency);
    }
}
