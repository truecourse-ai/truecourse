using System.IO;

namespace Positive.Boundary.Security;

/// <summary>Writes scratch data to a uniquely named OS temp file rather than a shared world-writable path.</summary>
public sealed class PubliclyWritableDirectorySafe
{
    /// <summary>Persists the payload to a fresh per-process temp file and returns its path.</summary>
    internal string WriteScratch(string payload)
    {
        var path = Path.GetTempFileName();
        // SAFE: security/deterministic/publicly-writable-directory
        File.WriteAllText(path, payload);
        return path;
    }
}
