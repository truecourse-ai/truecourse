namespace Positive.Boundary.CodeQuality;

/// <summary>
/// A null-or-empty test over two <em>different</em> operands — the null check
/// guards one string and the emptiness check inspects another — so it does not
/// restate <c>string.IsNullOrEmpty</c> on a single value and the rule must not fire.
/// </summary>
public class UseIsNullOrEmptySafe
{
    /// <summary>True when either the primary tag is missing or its fallback is empty.</summary>
    public bool NeedsTag(string tag, string fallback)
    {
        // SAFE: code-quality/deterministic/use-isnullorempty
        return tag == null || fallback.Length == 0;
    }
}
