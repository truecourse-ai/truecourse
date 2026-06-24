namespace Positive.Boundary.CodeQuality;

/// <summary>
/// Only a <c>#pragma warning restore</c> directive appears here, which re-enables
/// a diagnostic rather than suppressing it, so the in-source-suppression rule
/// (which scopes to <c>disable</c>) must not fire.
/// </summary>
public class InSourceSuppressionSafe
{
    /// <summary>Combines the two values after a pragma restore directive.</summary>
    public string Clean(string value, string suffix)
    {
        var combined = value.Trim();
        combined += suffix.Trim();
        // SAFE: code-quality/deterministic/in-source-suppression
#pragma warning restore CS0618
        return combined;
    }
}
