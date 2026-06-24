using System.IO;

namespace Positive.Boundary.Reliability;

/// <summary>Reads a file through a locally-owned stream that is always disposed.</summary>
public sealed class IDisposableNotDisposedSafe
{
    /// <summary>Returns the byte length of the file at the given path.</summary>
    internal long Measure(string path)
    {
        // SAFE: reliability/deterministic/idisposable-not-disposed
        using var stream = new FileStream(path, FileMode.Open, FileAccess.Read);
        return stream.Length;
    }
}
