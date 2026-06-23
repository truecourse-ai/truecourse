namespace Positive.Boundary.CodeQuality;

/// <summary>
/// A bitwise-mask test whose grouping is already made explicit with parentheses,
/// so the precedence trap is resolved and the rule must not fire.
/// </summary>
public class AddClarifyingParenthesesSafe
{
    /// <summary>True when none of the bits in <paramref name="mask"/> are set in <paramref name="flags"/>.</summary>
    public bool IsClear(int flags, int mask)
    {
        // SAFE: code-quality/deterministic/add-clarifying-parentheses
        return (flags & mask) == 0;
    }
}
