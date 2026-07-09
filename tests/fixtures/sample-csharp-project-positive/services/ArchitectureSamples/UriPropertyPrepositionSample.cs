namespace Positive.Boundary.Architecture;

/// <summary>
/// Holds a route segment that travels inside a URL but is itself an identifier,
/// not a URI. The name ends in <c>…InUrl</c> — a preposition before the URI token
/// signals the *context* a value appears in, not a URI value — so the
/// uri-property rule must not flag it.
/// </summary>
public sealed class UriPropertyPrepositionSample
{
    // SAFE: architecture/deterministic/uri-property-as-string
    /// <summary>The action-name segment carried within the route URL.</summary>
    public string SegmentInUrl { get; set; } = string.Empty;
}
