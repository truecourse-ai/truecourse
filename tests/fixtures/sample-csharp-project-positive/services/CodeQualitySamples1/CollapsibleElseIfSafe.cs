namespace Positive.Boundary.CodeQuality;

/// <summary>Chains conditions with else-if directly instead of a nested block.</summary>
public sealed class CollapsibleElseIfSafe
{
    /// <summary>Maps a tier code to a label using a flat else-if chain.</summary>
    internal string Label(int tier)
    {
        // SAFE: code-quality/deterministic/collapsible-else-if
        if (tier == 0)
        {
            return "free";
        }
        else if (tier == 1)
        {
            return "pro";
        }
        return "enterprise";
    }
}
