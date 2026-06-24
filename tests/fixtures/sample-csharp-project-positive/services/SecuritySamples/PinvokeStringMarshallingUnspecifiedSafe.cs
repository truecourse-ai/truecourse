using System.Runtime.InteropServices;

namespace Positive.Boundary.Security;

/// <summary>Declares a P/Invoke with a string parameter and explicit Unicode marshalling.</summary>
public static class PinvokeStringMarshallingUnspecifiedSafe
{
    // SAFE: security/deterministic/pinvoke-string-marshalling-unspecified
    [DllImport("legacy.dll", CharSet = CharSet.Unicode)]
    [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
    private static extern int LookupName(string key, out int handle);

    /// <summary>Looks up the native handle for the given key through a managed wrapper.</summary>
    internal static int Lookup(string key, out int handle)
    {
        return LookupName(key, out handle);
    }
}
