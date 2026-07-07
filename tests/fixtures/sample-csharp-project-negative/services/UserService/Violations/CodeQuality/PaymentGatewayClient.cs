namespace UserServiceApp.Violations.CodeQuality;

/// <summary>
/// A production client that hardcodes its base endpoint in source instead of
/// reading it from configuration. Unlike test seed data, this is a genuine
/// smell — the URL belongs in appsettings/IOptions. The rule must still fire.
/// </summary>
internal sealed class PaymentGatewayClient
{
    // VIOLATION: code-quality/deterministic/hardcoded-url
    private const string ApiBase = "https://api.acme-payments.net/v2";

    /// <summary>True when the configured base matches the compiled-in default.</summary>
    public bool UsesDefaultBase(string configured)
    {
        return configured == ApiBase;
    }
}
