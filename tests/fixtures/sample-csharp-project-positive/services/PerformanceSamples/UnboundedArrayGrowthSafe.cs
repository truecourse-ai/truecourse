using System.Collections.Generic;

namespace Positive.Boundary.Performance;

/// <summary>Drains a bounded number of samples from a channel.</summary>
public sealed class UnboundedArrayGrowthSafe
{
    private readonly List<int> _samples = new();

    /// <summary>Adds at most <paramref name="limit"/> samples; the loop variable advances each pass.</summary>
    internal void Drain(MetricsChannel channel, int limit)
    {
        var taken = 0;
        // SAFE: performance/deterministic/unbounded-array-growth
        while (taken < limit)
        {
            _samples.Add(channel.TakeNext());
            taken++;
        }
    }

    /// <summary>How many samples have been drained so far.</summary>
    internal int Count => _samples.Count;
}

/// <summary>Minimal channel that yields integer samples on demand.</summary>
internal sealed class MetricsChannel
{
    private int _next;

    /// <summary>Returns the next sample value.</summary>
    internal int TakeNext()
    {
        _next++;
        return _next;
    }
}
