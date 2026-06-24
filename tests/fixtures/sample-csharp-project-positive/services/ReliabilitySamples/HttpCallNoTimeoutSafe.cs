using System;
using System.Net.Http;

namespace Positive.Boundary.Reliability;

/// <summary>Builds an HttpClient with an explicit request timeout configured.</summary>
public sealed class HttpCallNoTimeoutSafe
{
    private const int TimeoutSeconds = 10;

    /// <summary>Creates a client whose Timeout is set in the initializer.</summary>
    internal HttpClient CreateClient()
    {
        // SAFE: reliability/deterministic/http-call-no-timeout
        return new HttpClient { Timeout = TimeSpan.FromSeconds(TimeoutSeconds) };
    }
}
