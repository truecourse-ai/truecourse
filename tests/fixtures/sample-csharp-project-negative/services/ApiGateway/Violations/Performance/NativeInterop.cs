using System.Runtime.InteropServices;
using System.Text;

namespace ApiGateway.Violations.Performance;

internal static partial class NativeInterop
{
    // VIOLATION: performance/deterministic/stringbuilder-pinvoke-parameter
    // VIOLATION: security/deterministic/pinvoke-no-dllimportsearchpath
    // VIOLATION: security/deterministic/pinvoke-string-marshalling-unspecified
    [DllImport("kernel32.dll", SetLastError = true)]
    internal static extern int GetModuleFileName(nint module, StringBuilder buffer, int size);
}
