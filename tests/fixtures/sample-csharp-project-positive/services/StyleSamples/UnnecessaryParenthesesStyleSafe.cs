namespace Positive.Boundary.Style;

/// <summary>Resolves a display name from candidates.</summary>
public sealed class UnnecessaryParenthesesStyleSafe
{
    /// <summary>Returns the primary name, falling back to the alternate.</summary>
    internal string Resolve(string? primary, string alternate)
    {
        // SAFE: style/deterministic/unnecessary-parentheses-style
        return (primary ?? alternate);
    }
}
