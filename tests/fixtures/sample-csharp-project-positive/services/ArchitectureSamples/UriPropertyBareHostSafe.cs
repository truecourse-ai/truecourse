using Microsoft.AspNetCore.Mvc;

namespace Positive.Boundary.Architecture;

/// <summary>
/// URI-named string properties that are not absolute System.Uri values: a bare
/// host with no scheme, a relative path, and a model-bound redirect target. Each
/// is legitimately a string, so uri-property-as-string must not fire.
/// </summary>
public sealed class UriPropertyBareHostSafe
{
    // SAFE: architecture/deterministic/uri-property-as-string
    /// <summary>A bare host with no scheme — a string, not an absolute URI.</summary>
    public string Endpoint { get; set; } = "sms.tencentcloudapi.com";

    // SAFE: architecture/deterministic/uri-property-as-string
    /// <summary>A relative path, not an absolute URI.</summary>
    public string CallbackUrl { get; set; } = "/webhooks/receive";

    // SAFE: architecture/deterministic/uri-property-as-string
    /// <summary>Model-bound from the query string; retyping to Uri breaks binding.</summary>
    [FromQuery]
    public string ReturnUrl { get; set; } = string.Empty;
}
