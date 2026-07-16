namespace UserServiceApp.Violations.CodeQuality;

/// <summary>Calls a partner API at a hardcoded base URL that belongs in configuration.</summary>
internal sealed class PartnerApiClient
{
    // VIOLATION: code-quality/deterministic/hardcoded-url
    private const string BaseUrl = "https://api.acme-partner.io/v2";

    /// <summary>Returns the partner service base address.</summary>
    public string Read() => BaseUrl;
}
