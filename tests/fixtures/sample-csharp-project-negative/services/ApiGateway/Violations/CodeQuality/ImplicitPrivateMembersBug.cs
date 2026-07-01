namespace ApiGatewayApp.Violations.CodeQuality;

/// <summary>
/// Ordinary members that lack an access modifier — NOT explicit interface
/// implementations (which are forbidden a modifier). An implicitly-private member
/// with no modifier is genuinely ambiguous, so missing-access-modifier must still
/// fire; a private field that is never read is genuinely dead, so
/// unused-private-member must still fire.
/// </summary>
internal sealed class ImplicitPrivateMembersBug
{
    // VIOLATION: code-quality/deterministic/unused-private-member
    private readonly string _unusedTag = "n/a";

    // VIOLATION: code-quality/deterministic/missing-access-modifier
    // VIOLATION: code-quality/deterministic/static-method-candidate
    decimal Subtotal(decimal net, decimal rate) => net * rate;

    /// <summary>Grosses up the net amount at the given rate.</summary>
    public decimal Total(decimal net, decimal rate) => Subtotal(net, rate);
}
