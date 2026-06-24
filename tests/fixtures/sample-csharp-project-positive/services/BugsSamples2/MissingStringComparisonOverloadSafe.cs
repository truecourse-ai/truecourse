namespace Positive.Boundary.Bugs;

/// <summary>Compares route prefixes with an explicit ordinal comparison.</summary>
internal sealed class MissingStringComparisonOverloadSafe
{
    /// <summary>Returns true when the route begins with the given prefix using an ordinal compare.</summary>
    internal bool HasPrefix(string route, string prefix)
    {
        // SAFE: bugs/deterministic/missing-stringcomparison-overload
        return route.StartsWith(prefix, System.StringComparison.Ordinal);
    }
}
