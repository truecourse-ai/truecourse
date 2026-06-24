using System.IO;

namespace Positive.Boundary.Reliability;

/// <summary>Opens a file inside a try, releasing it via a using declaration.</summary>
public sealed class MissingFinallyCleanupSafe
{
    /// <summary>Returns the file length, or zero when the read fails.</summary>
    internal long TryMeasure(string path)
    {
        try
        {
            // SAFE: reliability/deterministic/missing-finally-cleanup
            using var stream = new FileStream(path, FileMode.Open, FileAccess.Read);
            return stream.Length;
        }
        catch (IOException)
        {
            return 0;
        }
    }
}
