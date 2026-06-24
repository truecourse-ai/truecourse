using System;
using System.Globalization;

namespace Positive.Boundary.Architecture;

/// <summary>Builds delivery targets for webhook payloads.</summary>
public sealed class UriReturnAsStringSafe
{
    private readonly Uri _baseUri;

    /// <summary>Creates the builder over a validated base endpoint.</summary>
    public UriReturnAsStringSafe(Uri baseUri)
    {
        _baseUri = baseUri;
    }

    // SAFE: architecture/deterministic/uri-return-as-string
    /// <summary>Builds the absolute delivery URL for a payload id as a validated Uri.</summary>
    public Uri BuildDeliveryUrl(int payloadId)
    {
        return new Uri(_baseUri, payloadId.ToString(CultureInfo.InvariantCulture));
    }
}
