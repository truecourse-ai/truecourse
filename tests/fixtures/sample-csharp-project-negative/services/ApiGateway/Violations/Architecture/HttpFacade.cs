using System;

namespace ApiGateway.Violations.Architecture;

/// <summary>
/// A thin HTTP client facade. It offers both a Uri and a string overload of Fetch,
/// but the string overload pulls the host out by hand instead of delegating to the
/// validated Uri overload.
/// </summary>
internal sealed class HttpFacade
{
    private readonly string _userAgent;

    public HttpFacade(string userAgent) => _userAgent = userAgent;

    /// <summary>Fetches the resource at the given URI.</summary>
    public string Fetch(Uri endpoint) => endpoint.Host + _userAgent;

    /// <summary>Fetches the resource at the given URL string.</summary>
    // VIOLATION: architecture/deterministic/uri-string-overload-not-delegating
    // VIOLATION: architecture/deterministic/uri-parameter-as-string
    public string Fetch(string endpoint) => endpoint.Substring(0, endpoint.IndexOf('/')) + _userAgent;
}
