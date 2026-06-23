using System;
using System.Runtime.InteropServices;

namespace Positive.Boundary.Performance;

/// <summary>Declares a native call that fills a caller-owned char buffer.</summary>
internal static partial class StringbuilderPinvokeParameterSafe
{
    // SAFE: performance/deterministic/stringbuilder-pinvoke-parameter
    [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    internal static extern int GetModuleFileName(nint module, Span<char> buffer, int size);
}
