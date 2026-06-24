namespace Positive.Boundary.CodeQuality;

/// <summary>
/// A property backed by an explicit setter that also exposes a getter, so a stored value
/// can be read back. The rule fires only when a property declares a setter with no
/// getter, so this read/write pair must not fire. The setter normalizes the value, so the
/// accessors do real work and cannot collapse to an auto-property.
/// </summary>
public class WriteOnlyPropertySafe
{
    private string _token = string.Empty;

    // SAFE: code-quality/deterministic/write-only-property
    /// <summary>The access token; both readable and writable.</summary>
    public string Token
    {
        get => _token;
        set => _token = value.Trim();
    }
}
