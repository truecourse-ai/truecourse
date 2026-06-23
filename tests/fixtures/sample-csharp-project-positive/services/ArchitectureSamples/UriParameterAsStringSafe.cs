namespace Positive.Boundary.Architecture;

/// <summary>Delivers notifications; the URL-string helper is internal, not public surface.</summary>
public sealed class UriParameterAsStringSafe
{
    /// <summary>Delivers a body to the configured subscriber.</summary>
    public bool Deliver(string body)
    {
        return DeliverTo(_endpoint, body);
    }

    private readonly string _endpoint = string.Empty;

    // SAFE: architecture/deterministic/uri-parameter-as-string
    internal bool DeliverTo(string subscriberUrl, string body)
    {
        return subscriberUrl.Length > 0 && body.Length > 0;
    }
}
