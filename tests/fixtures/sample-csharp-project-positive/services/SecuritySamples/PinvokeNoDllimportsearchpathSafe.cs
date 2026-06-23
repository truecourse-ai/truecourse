using System.Runtime.InteropServices;

namespace Positive.Boundary.Security;

/// <summary>Declares a P/Invoke with an explicit, constrained native search path.</summary>
public static class PinvokeNoDllimportsearchpathSafe
{
    // SAFE: security/deterministic/pinvoke-no-dllimportsearchpath
    [DllImport("metrics.dll")]
    [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
    private static extern int ReadCounter(int slot);

    /// <summary>Reads the native counter at the given slot through a managed wrapper.</summary>
    internal static int Read(int slot)
    {
        return ReadCounter(slot);
    }
}
