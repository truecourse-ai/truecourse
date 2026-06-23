namespace Positive.Boundary.CodeQuality;

/// <summary>
/// Uses the .NET idiom string.IsNullOrEmpty instead of comparing against "",
/// so the compare-to-empty-string rule must not fire.
/// </summary>
public class CompareToEmptyStringSafe
{
    /// <summary>True when <paramref name="name"/> carries a usable value.</summary>
    public bool HasName(string name)
    {
        // SAFE: code-quality/deterministic/compare-to-empty-string
        return !string.IsNullOrEmpty(name);
    }
}
