using System;
using System.Runtime.CompilerServices;

namespace Utils.Violations.CodeQuality;

/// <summary>
/// Flips an AppContext switch the moment this assembly loads. Because it is a module
/// initializer in a shared library, it runs before any consumer code, on a thread and
/// at a time the consuming application never chose — a hidden startup side effect
/// imposed on everyone who references Utils.
/// </summary>
internal static class ModuleBootstrap
{
    // VIOLATION: code-quality/deterministic/moduleinitializer-in-library
    [ModuleInitializer]
    internal static void Initialize()
    {
        AppContext.SetSwitch("Utils.Warmed", true);
    }
}
