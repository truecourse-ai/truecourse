using System.Collections.Generic;

namespace Positive.Boundary.Performance;

/// <summary>Collects expired entries from a custom buffer without forcing a GC.</summary>
public sealed class ExplicitGcCollectSafe
{
    private readonly List<string> _expired = new();

    /// <summary>Gathers expired keys into the local buffer and returns the count.</summary>
    internal int Reclaim(IEnumerable<string> keys)
    {
        var buffer = new EntryBuffer();
        foreach (var key in keys)
        {
            buffer.Add(key, _expired);
        }
        // SAFE: performance/deterministic/explicit-gc-collect
        return buffer.Collect(_expired);
    }

    private sealed class EntryBuffer
    {
        private readonly List<string> _pending = new();

        internal void Add(string key, List<string> sink)
        {
            _pending.Add(key);
            sink.Add(key);
        }

        internal int Collect(List<string> sink)
        {
            sink.AddRange(_pending);
            return _pending.Count;
        }
    }
}
