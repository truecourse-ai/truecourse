namespace Demo.Sitemaps;

/// <summary>
/// Writes sitemap XML. The sitemaps.org schema URL is a fixed XML namespace
/// identifier (like a w3.org or schema.org namespace), not a configurable
/// network endpoint, so it must not be flagged as a hardcoded URL.
/// </summary>
public sealed class SitemapWriter
{
    // SAFE: code-quality/deterministic/hardcoded-url
    private const string SchemaNamespace = "https://www.sitemaps.org/schemas/sitemap/0.9";

    /// <summary>Reports whether the given namespace is the sitemap schema namespace.</summary>
    public bool Matches(string ns) => ns == SchemaNamespace;
}
