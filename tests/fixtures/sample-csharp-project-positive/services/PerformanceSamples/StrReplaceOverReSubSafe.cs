namespace Positive.Boundary.Performance;

/// <summary>Rewrites a cache key prefix with a plain substring swap.</summary>
public sealed class StrReplaceOverReSubSafe
{
    /// <summary>Returns the key with its prefix namespace replaced.</summary>
    internal string Normalize(string rawKey)
    {
        // SAFE: performance/deterministic/str-replace-over-re-sub
        return rawKey.Replace("cache:", "key:");
    }
}
