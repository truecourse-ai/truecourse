using System.Runtime.InteropServices;

namespace Positive.Boundary.Bugs;

/// <summary>
/// A P/Invoke that fills a caller-allocated [Out] char[] buffer rather than a by-value
/// string. A writable char buffer is the correct mutable marshalling target, so the rule
/// (which targets [Out] on a by-value string) must not fire.
/// </summary>
public static class PInvokeOutStringParameterSafe
{
    // SAFE: bugs/deterministic/pinvoke-out-string-parameter
    [DllImport("native", CharSet = CharSet.Unicode)]
    [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
    internal static extern int ReadName([Out] char[] buffer);
}
