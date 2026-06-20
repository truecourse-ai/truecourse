using System;
using System.Runtime.InteropServices;

namespace ApiGateway.Violations.Security;

internal static class NativeInterop
{
    // VIOLATION: security/deterministic/pinvoke-publicly-visible
    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool CloseHandle(IntPtr handle);
}
