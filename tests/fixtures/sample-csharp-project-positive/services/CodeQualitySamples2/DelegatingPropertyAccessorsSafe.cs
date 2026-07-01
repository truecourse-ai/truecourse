namespace Positive.Boundary.CodeQuality;

/// <summary>
/// Each property delegates to its matching GetX() method — a single implementation
/// exposed through the property surface (the idiomatic public property over an
/// overridable GetX()), not two competing ways to obtain the value. Neither
/// property-name-matches-get-method nor property-matches-get-method must fire.
/// </summary>
// SAFE: code-quality/deterministic/property-name-matches-get-method
// SAFE: code-quality/deterministic/property-matches-get-method
public class DelegatingPropertyAccessorsSafe
{
    public string BrowserInfo => GetBrowserInfo();

    public string ClientAddress
    {
        get { return GetClientAddress(); }
    }

    protected virtual string GetBrowserInfo() => "unknown";

    protected virtual string GetClientAddress() => "0.0.0.0";
}
