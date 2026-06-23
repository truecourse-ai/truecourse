namespace Positive.Boundary.CodeQuality;

/// <summary>
/// Reads a named tuple element through its declared name rather than the
/// positional <c>Item1</c> metadata name, which is the form the rule does not
/// flag.
/// </summary>
public class TupleElementByNameSafe
{
    /// <summary>Returns the hit/miss counters for the cache.</summary>
    public (int Hits, int Misses) Counters(int hits, int misses)
    {
        return (hits, misses);
    }

    /// <summary>Returns the number of cache hits.</summary>
    public int HitCount(int hits, int misses)
    {
        var stats = Counters(hits, misses);
        // SAFE: code-quality/deterministic/tuple-element-by-name
        return stats.Hits;
    }
}
