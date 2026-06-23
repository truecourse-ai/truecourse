using System.Net.Http;

namespace ApiGateway.Violations.Bugs;

/// <summary>
/// Builds the upstream HTTP handler. The header-length cap was set in bytes by
/// mistake — the property is measured in kilobytes — so the limit is effectively
/// unbounded and the unbounded-header protection is lost.
/// </summary>
internal static class HttpClientTuning
{
    /// <summary>Creates the configured upstream handler.</summary>
    public static HttpClientHandler CreateHandler()
    {
        return new HttpClientHandler
        {
            // VIOLATION: bugs/deterministic/maxresponseheaderslength-misset
            MaxResponseHeadersLength = 65536,
        };
    }
}
