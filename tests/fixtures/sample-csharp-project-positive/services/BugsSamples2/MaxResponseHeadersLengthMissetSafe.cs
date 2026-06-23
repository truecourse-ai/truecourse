using System.Net.Http;

namespace Positive.Boundary.Bugs;

/// <summary>Builds an HTTP handler with a sane kilobyte header budget.</summary>
public sealed class MaxResponseHeadersLengthMissetSafe
{
    private const int HeaderBudgetKilobytes = 64;

    /// <summary>Creates a handler capped at the default kilobyte header budget.</summary>
    public HttpClientHandler CreateHandler()
    {
        return new HttpClientHandler
        {
            // SAFE: bugs/deterministic/maxresponseheaderslength-misset
            MaxResponseHeadersLength = HeaderBudgetKilobytes,
        };
    }
}
