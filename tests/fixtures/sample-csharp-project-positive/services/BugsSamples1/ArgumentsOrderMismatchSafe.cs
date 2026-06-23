namespace Positive.Boundary.Bugs;

/// <summary>Checks a route against a distinct prefix argument.</summary>
public sealed class ArgumentsOrderMismatchSafe
{
    /// <summary>Returns true when the route begins with the given prefix.</summary>
    public bool MatchesPrefix(string route, string prefix)
    {
        if (prefix.Length == 0)
        {
            return false;
        }
        // SAFE: bugs/deterministic/arguments-order-mismatch
        return route.StartsWith(prefix, System.StringComparison.Ordinal);
    }
}
