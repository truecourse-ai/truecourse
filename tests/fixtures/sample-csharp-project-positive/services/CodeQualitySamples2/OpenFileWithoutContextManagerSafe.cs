using System.IO;

namespace Positive.Boundary.CodeQuality;

/// <summary>
/// A file handle acquired with a <c>using</c> declaration, so the stream is
/// disposed deterministically at scope exit and the rule must not fire.
/// </summary>
public class OpenFileWithoutContextManagerSafe
{
    // SAFE: code-quality/deterministic/open-file-without-context-manager
    internal string ReadFirstLine(string path)
    {
        using var reader = new StreamReader(path);
        return reader.ReadLine() ?? string.Empty;
    }
}
