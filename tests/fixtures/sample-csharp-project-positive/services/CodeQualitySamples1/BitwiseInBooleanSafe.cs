namespace Positive.Boundary.CodeQuality;

/// <summary>Combines pre-computed flags with deliberate non-short-circuit logic.</summary>
public sealed class BitwiseInBooleanSafe
{
    /// <summary>Runs the audit when both flags are set, evaluating both deliberately.</summary>
    internal string Decide(bool primary, bool secondary)
    {
        // SAFE: code-quality/deterministic/bitwise-in-boolean
        if (primary & secondary)
        {
            return "audit";
        }
        return "skip";
    }
}
