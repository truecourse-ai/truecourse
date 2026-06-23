namespace Positive.Boundary.CodeQuality;

/// <summary>
/// Decodes a manifest into a concrete typed result instead of `dynamic`, so
/// every member access stays compile-time checked and the rule must not fire.
/// </summary>
public sealed class UnsafeAnyUsageSafe
{
    /// <summary>Returns the version string carried by the decoded manifest.</summary>
    internal string Version(Manifest manifest)
    {
        // SAFE: code-quality/deterministic/unsafe-any-usage
        return manifest.Version;
    }
}

/// <summary>A decoded manifest with a strongly typed version field.</summary>
internal sealed class Manifest
{
    /// <summary>The manifest schema version.</summary>
    public string Version { get; }

    /// <summary>Creates a manifest with the given version.</summary>
    public Manifest(string version)
    {
        Version = version;
    }
}
