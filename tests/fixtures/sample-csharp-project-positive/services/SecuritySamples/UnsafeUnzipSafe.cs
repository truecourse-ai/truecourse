using System;
using System.IO;
using System.IO.Compression;

namespace Positive.Boundary.Security;

/// <summary>Extracts an archive entry only after verifying it stays inside the target root.</summary>
public sealed class UnsafeUnzipSafe
{
    /// <summary>Writes the entry to disk when its resolved path is contained by the destination.</summary>
    internal void ExtractEntry(ZipArchiveEntry entry, string destination)
    {
        var root = Path.GetFullPath(destination);
        var target = Path.GetFullPath(Path.Combine(root, entry.FullName));
        if (!target.StartsWith(root, StringComparison.Ordinal))
        {
            return;
        }
        // SAFE: security/deterministic/unsafe-unzip
        entry.ExtractToFile(target);
    }
}
