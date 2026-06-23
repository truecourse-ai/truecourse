using System.Net.Http;

namespace Positive.Boundary.CodeQuality;

/// <summary>
/// Builds a request with the modern `HttpRequestMessage` API rather than the
/// deprecated `WebRequest.Create` / `WebClient` / `HttpWebRequest`, so the
/// deprecated-api-usage rule must not fire.
/// </summary>
public class DeprecatedApiUsageSafe
{
    /// <summary>Builds a GET request message for the given target.</summary>
    public HttpRequestMessage BuildRequest(string target)
    {
        // SAFE: code-quality/deterministic/deprecated-api-usage
        return new HttpRequestMessage(HttpMethod.Get, target);
    }
}
