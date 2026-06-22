using System;
using System.Runtime.InteropServices;

namespace ApiGateway.Violations.Security;

internal static class NativeInteropMarshalling
{
    // No DefaultDllImportSearchPaths attribute and an integer-only signature, so
    // only the missing-search-path rule fires.
    // VIOLATION: security/deterministic/pinvoke-no-dllimportsearchpath
    [DllImport("metrics.dll")]
    internal static extern int ReadCounter(int slot);

    // A search path is constrained (System32, safe) so the marshalling of the
    // string parameter is the only outstanding issue.
    // VIOLATION: security/deterministic/pinvoke-string-marshalling-unspecified
    [DllImport("legacy.dll")]
    [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
    internal static extern int LookupName(string key, out int handle);

    // An explicit but unsafe search path keeps an attacker-writable directory
    // in the probe order.
    // VIOLATION: security/deterministic/unsafe-dllimportsearchpath
    [DllImport("plugin.dll")]
    [DefaultDllImportSearchPaths(DllImportSearchPath.LegacyBehavior)]
    internal static extern int LoadPlugin(int id);
}
