namespace Positive.Boundary.CodeQuality;

/// <summary>
/// A single boolean negation is the intended operation, not a redundant
/// `!!`, so the double-negation rule must not fire.
/// </summary>
public class DoubleNegationSafe
{
    /// <summary>Returns whether the plan still needs an audit.</summary>
    public bool NeedsAudit(bool isAudited)
    {
        // SAFE: code-quality/deterministic/double-negation
        return !isAudited;
    }
}
