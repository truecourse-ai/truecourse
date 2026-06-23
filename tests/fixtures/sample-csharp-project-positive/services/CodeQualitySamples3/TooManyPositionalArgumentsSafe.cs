namespace Positive.Boundary.CodeQuality;

/// <summary>Builds a connection descriptor from exactly the maximum allowed parameter count.</summary>
public sealed class TooManyPositionalArgumentsSafe
{
    /// <summary>Composes a descriptor string from five related connection inputs.</summary>
    // SAFE: code-quality/deterministic/too-many-positional-arguments
    internal string Describe(string host, int port, string database, string user, bool secure)
    {
        var scheme = secure ? "tls" : "plain";
        return $"{scheme}://{user}@{host}:{port}/{database}";
    }
}
