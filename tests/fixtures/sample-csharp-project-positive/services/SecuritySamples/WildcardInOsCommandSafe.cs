using System.Diagnostics;

namespace Positive.Boundary.Security;

/// <summary>Launches a non-shell tool with a glob filter argument.</summary>
public sealed class WildcardInOsCommandSafe
{
    /// <summary>Runs the archiver against a wildcard filter without a shell.</summary>
    internal void ArchiveLogs(string archiverPath)
    {
        // SAFE: security/deterministic/wildcard-in-os-command
        var info = new ProcessStartInfo { FileName = archiverPath, Arguments = "--filter *.log" };
        Process.Start(info);
    }
}
