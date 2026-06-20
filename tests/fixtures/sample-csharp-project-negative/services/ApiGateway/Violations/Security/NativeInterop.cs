using System;
using System.Runtime.InteropServices;

namespace ApiGateway.Violations.Security;

internal static class NativeInterop
{
    // VIOLATION: security/deterministic/pinvoke-no-dllimportsearchpath
    // VIOLATION: security/deterministic/pinvoke-publicly-visible
    // VIOLATION: code-quality/deterministic/native-method-not-wrapped
    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool CloseHandle(IntPtr handle);
}
