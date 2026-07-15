namespace Positive.Boundary.CodeQuality;

/// <summary>
/// A three-arm if / else-if / else chain assigning one variable. It is not a
/// binary if/else, so collapsing it into a two-arm ternary would drop an arm —
/// if-else-instead-of-ternary must not fire on the else-if tail.
/// </summary>
public sealed class IfElseTernaryChainSafe
{
    /// <summary>Selects a tier label from two independent flags.</summary>
    public string SelectTier(bool isPremium, bool isTrial)
    {
        string tier;
        // SAFE: code-quality/deterministic/if-else-instead-of-ternary
        if (isPremium)
        {
            tier = "premium";
        }
        else if (isTrial)
        {
            tier = "trial";
        }
        else
        {
            tier = "standard";
        }
        return tier;
    }
}
