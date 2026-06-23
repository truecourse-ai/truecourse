namespace Positive.Boundary.CodeQuality;

/// <summary>
/// A property with an explicit backing field whose setter does real work
/// (it trims the incoming value before storing it). Because the accessor is not
/// a plain <c>_field = value;</c> passthrough, it cannot collapse to an
/// auto-property and the rule must not fire.
/// </summary>
public sealed class UseAutoPropertySafe
{
    private string _label = string.Empty;

    /// <summary>The label, normalized by trimming surrounding whitespace.</summary>
    // SAFE: code-quality/deterministic/use-auto-property
    public string Label
    {
        get { return _label; }
        set { _label = value.Trim(); }
    }
}
