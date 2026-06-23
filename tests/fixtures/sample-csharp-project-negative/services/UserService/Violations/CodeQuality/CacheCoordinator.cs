using System;

namespace UserServiceApp.Violations.CodeQuality;

internal abstract class CacheBase
{
    /// <summary>Stores a payload under the given key.</summary>
    public abstract void Store(string key, object payload);
}

/// <summary>
/// Coordinates the per-user cache. A nested entry type reuses a name from the
/// enclosing static surface, and the override renames a parameter from its base.
/// </summary>
internal sealed class CacheCoordinator : CacheBase
{
    public static readonly TimeSpan DefaultTtl = TimeSpan.FromMinutes(5);

    // VIOLATION: code-quality/deterministic/override-parameter-name-mismatch
    public override void Store(string cacheKey, object payload)
    {
        // VIOLATION: code-quality/deterministic/dead-store
        _ = cacheKey;
        _ = payload;
    }

    // VIOLATION: code-quality/deterministic/unused-private-nested-class
    private sealed class Entry
    {
        // VIOLATION: code-quality/deterministic/inner-member-shadows-outer
        // VIOLATION: code-quality/deterministic/member-more-visible-than-type
        public TimeSpan DefaultTtl { get; set; }

        // VIOLATION: code-quality/deterministic/member-more-visible-than-type
        public object? Value { get; set; }
    }

    /// <summary>Returns the current hit/miss counters.</summary>
    public (int Hits, int Misses) Stats(int hits, int misses)
    {
        return (hits, misses);
    }

    /// <summary>Returns the number of cache hits.</summary>
    public int HitCount()
    {
        // VIOLATION: code-quality/deterministic/magic-number
        var stats = Stats(3, 1);
        // VIOLATION: code-quality/deterministic/tuple-element-by-name
        return stats.Item1;
    }

    /// <summary>True when the key contains the given segment.</summary>
    public bool ContainsKeySegment(string key, string segment)
    {
        // VIOLATION: code-quality/deterministic/prefer-includes
        // VIOLATION: code-quality/deterministic/indexof-for-presence-check
        return key.IndexOf(segment, StringComparison.Ordinal) >= 0;
    }
}
