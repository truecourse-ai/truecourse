using System.Diagnostics;

namespace Positive.Boundary.Security;

/// <summary>Launches a tool by its full absolute path, never by bare executable name.</summary>
public sealed class CommandResolvedFromPathSafe
{
    private const string ToolPath = @"C:\Program Files\Converter\converter.exe";

    /// <summary>Starts the converter using an absolute path so PATH is not consulted.</summary>
    internal void LaunchTool()
    {
        // SAFE: security/deterministic/command-resolved-from-path
        Process.Start(ToolPath);
    }
}
