namespace Positive.Boundary.Security;

/// <summary>Builds links that keep secrets out of the URL query string.</summary>
public sealed class SensitiveDataInUrlSafe
{
    /// <summary>Returns a reset link whose token rides in the path, not a query parameter.</summary>
    internal string BuildResetLink(string token)
    {
        // SAFE: security/deterministic/sensitive-data-in-url
        return "https://app.example.com/reset/" + token;
    }
}
