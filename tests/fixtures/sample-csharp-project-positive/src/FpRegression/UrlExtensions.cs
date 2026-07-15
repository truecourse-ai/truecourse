using System;
using System.Text;

namespace Demo.Web;

/// <summary>
/// URL-shaped string helpers exposed as extension methods. An extension method's
/// string parameters mirror the conventions of the type it extends (here a
/// framework StringBuilder), so a URL-named string parameter follows that shape
/// rather than the "accept System.Uri at your boundary" guidance and must not be
/// flagged as a URI typed as string.
/// </summary>
public static class UrlExtensions
{
    /// <summary>Appends a local URL to the builder, mirroring a string-based API.</summary>
    public static StringBuilder AppendLocalUrl(this StringBuilder builder, string localUrl)
    {
        ArgumentNullException.ThrowIfNull(builder);
        ArgumentNullException.ThrowIfNull(localUrl);
        return builder.Append(localUrl);
    }
}
