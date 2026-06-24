using System;

namespace Positive.Boundary.Architecture;

/// <summary>Dispatches webhooks; the URL-string entry point is internal, not public API.</summary>
public sealed class PreferUriOverStringSafe
{
    /// <summary>Posts a body to the configured endpoint.</summary>
    public bool Notify(string body)
    {
        return Post(_endpoint, body);
    }

    private readonly string _endpoint = string.Empty;

    // SAFE: architecture/deterministic/prefer-uri-over-string
    internal bool Post(string url, string body)
    {
        return Uri.TryCreate(url, UriKind.Absolute, out _) && body.Length > 0;
    }
}
