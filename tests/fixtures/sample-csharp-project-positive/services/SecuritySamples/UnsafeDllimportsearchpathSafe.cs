using System.Runtime.InteropServices;

namespace Positive.Boundary.Security;

/// <summary>Declares a P/Invoke that probes only the protected System32 directory.</summary>
public static class UnsafeDllimportsearchpathSafe
{
    [DllImport("metrics.dll")]
    // SAFE: security/deterministic/unsafe-dllimportsearchpath
    [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
    private static extern int ReadCounter(int slot);

    /// <summary>Reads the native counter at the given slot through a managed wrapper.</summary>
    internal static int Read(int slot)
    {
        return ReadCounter(slot);
    }
}
