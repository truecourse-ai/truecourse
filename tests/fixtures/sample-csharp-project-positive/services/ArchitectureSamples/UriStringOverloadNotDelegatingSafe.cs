using System;

namespace Positive.Boundary.Architecture;

/// <summary>
/// A thin HTTP client facade exposing both a Uri and a string overload of Fetch,
/// where the string overload delegates to the validated Uri overload.
/// </summary>
public sealed class UriStringOverloadNotDelegatingSafe
{
    private readonly string _userAgent;

    /// <summary>Creates the facade with a user-agent header value.</summary>
    public UriStringOverloadNotDelegatingSafe(string userAgent)
    {
        _userAgent = userAgent;
    }

    // SAFE: architecture/deterministic/uri-string-overload-not-delegating
    /// <summary>Fetches the resource at the given raw address by forwarding to the Uri overload.</summary>
    public string Fetch(string rawTarget)
    {
        return Fetch(new Uri(rawTarget));
    }

    /// <summary>Fetches the resource at the validated URI.</summary>
    public string Fetch(Uri endpoint)
    {
        return endpoint.Host + _userAgent;
    }
}
