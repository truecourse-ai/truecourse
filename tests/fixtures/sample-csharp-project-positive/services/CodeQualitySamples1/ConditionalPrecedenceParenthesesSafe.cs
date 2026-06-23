namespace Positive.Boundary.CodeQuality;

/// <summary>
/// Mixes &amp;&amp; and || but wraps the &amp;&amp; group in explicit parentheses, so the
/// grouping is unambiguous and the conditional-precedence rule must not fire.
/// </summary>
public class ConditionalPrecedenceParenthesesSafe
{
    /// <summary>True when access is granted under the parenthesized policy.</summary>
    public bool IsAllowed(bool isAdmin, bool isOwner, bool isActive)
    {
        // SAFE: code-quality/deterministic/conditional-precedence-parentheses
        return isAdmin || (isOwner && isActive);
    }
}
