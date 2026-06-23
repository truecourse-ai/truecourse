namespace Positive.Boundary.CodeQuality;

/// <summary>
/// A single conditional expression whose branches are plain values, so there is
/// no ternary nested inside another and the rule must not fire.
/// </summary>
public class NestedTernarySafe
{
    /// <summary>Returns a sign label for the supplied value.</summary>
    public string Sign(int value)
    {
        // SAFE: code-quality/deterministic/nested-ternary
        return value > 0 ? "positive" : "non-positive";
    }
}
