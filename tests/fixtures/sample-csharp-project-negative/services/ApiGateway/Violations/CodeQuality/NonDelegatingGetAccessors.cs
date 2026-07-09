namespace ApiGatewayApp.Violations.CodeQuality;

/// <summary>
/// A property and a matching GetX() method that do NOT share one implementation:
/// the property stores its own value while the method computes a different result.
/// This is the confusing "two competing ways to obtain the value" shape (not the
/// idiomatic property-delegates-to-GetX() pattern), so both
/// property-name-matches-get-method and property-matches-get-method must still fire.
/// </summary>
internal sealed class NonDelegatingGetAccessors
{
    public string DisplayName { get; set; } = string.Empty;

    // VIOLATION: code-quality/deterministic/property-name-matches-get-method
    // VIOLATION: code-quality/deterministic/property-matches-get-method
    public string GetDisplayName() => DisplayName.Trim();
}
