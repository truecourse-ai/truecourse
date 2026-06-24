namespace Positive.Boundary.CodeQuality;

/// <summary>
/// A property that exposes both a getter and a setter, so a stored value can
/// always be read back. The write-only-property rule must not fire.
/// </summary>
public class AccessorPairsSafe
{
    /// <summary>The display name; readable and writable.</summary>
    // SAFE: code-quality/deterministic/accessor-pairs
    public string DisplayName { get; set; } = string.Empty;
}
