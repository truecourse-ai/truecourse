using System.Runtime.InteropServices;

namespace Positive.Boundary.CodeQuality;

/// <summary>
/// A P/Invoke declaration kept <c>private</c> behind a validated managed
/// wrapper, so the unwrapped-native rule (which only flags <c>public</c>
/// externs) must not fire.
/// </summary>
public class NativeMethodNotWrappedSafe
{
    // SAFE: code-quality/deterministic/native-method-not-wrapped
    [DllImport("kernel32.dll", SetLastError = true)]
    [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
    private static extern uint GetCurrentProcessId();

    /// <summary>Returns the current process id through a managed wrapper.</summary>
    public uint CurrentProcessId()
    {
        return GetCurrentProcessId();
    }
}
