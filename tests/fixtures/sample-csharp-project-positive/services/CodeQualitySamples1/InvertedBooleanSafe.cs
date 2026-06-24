namespace Positive.Boundary.CodeQuality;

/// <summary>
/// A single negation of a parenthesized comparison. The rule only flags a
/// negation wrapping a parenthesized negation (<c>!(!x)</c>); a lone <c>!</c>
/// over a relational test is the idiomatic form and must not fire.
/// </summary>
public sealed class InvertedBooleanSafe
{
    /// <summary>True when the queue holds nothing left to ship.</summary>
    public bool CanShip(int pendingReviews)
    {
        // SAFE: code-quality/deterministic/inverted-boolean
        return !(pendingReviews > 0);
    }
}
