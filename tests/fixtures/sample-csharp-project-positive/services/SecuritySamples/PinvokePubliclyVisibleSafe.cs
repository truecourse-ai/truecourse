using System;
using System.Runtime.InteropServices;

namespace Positive.Boundary.Security;

/// <summary>Wraps a non-public native handle-close entry point.</summary>
public static class PinvokePubliclyVisibleSafe
{
    // SAFE: security/deterministic/pinvoke-publicly-visible
    [DllImport("kernel32.dll", SetLastError = true)]
    [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
    private static extern bool CloseHandle(IntPtr handle);

    /// <summary>Closes the given native handle through a validated managed wrapper.</summary>
    internal static bool Close(IntPtr handle)
    {
        return handle != IntPtr.Zero && CloseHandle(handle);
    }
}
