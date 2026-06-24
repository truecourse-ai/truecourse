using System;

namespace Positive.Boundary.Architecture;

/// <summary>Describes a registered webhook endpoint with a validated callback target.</summary>
public sealed class UriPropertyAsStringSafe
{
    // SAFE: architecture/deterministic/uri-property-as-string
    /// <summary>The validated callback target the URI name signals.</summary>
    public Uri CallbackUrl { get; set; } = new Uri("https://localhost", UriKind.Absolute);
}
