namespace Positive.Boundary.CodeQuality;

/// <summary>
/// Two thin delegators with the same one-expression body. The rule only compares
/// <c>block</c> bodies and explicitly skips expression-bodied members, since
/// identical text there is idiomatic forwarding rather than duplication.
/// </summary>
public sealed class IdenticalFunctionsSafe
{
    private readonly System.Collections.Generic.List<string> _items = new();

    /// <summary>Number of queued items.</summary>
    // SAFE: code-quality/deterministic/identical-functions
    internal int Count => _items.Count;

    /// <summary>Number of pending items (same forwarding shape, expression-bodied).</summary>
    internal int Pending => _items.Count;
}
