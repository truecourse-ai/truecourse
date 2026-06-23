using System.Reflection;

namespace Positive.Boundary.CodeQuality;

/// <summary>
/// Loads a diagnostics assembly through <c>Assembly.Load</c>, which uses the
/// default binding context and is the safe form. Because it is neither
/// <c>LoadFrom</c> nor <c>LoadFile</c>, the load-context check must not fire.
/// </summary>
public sealed class PreferAssemblyLoadSafe
{
    /// <summary>Loads the diagnostics assembly by its display name.</summary>
    // SAFE: code-quality/deterministic/prefer-assembly-load
    internal Assembly LoadDiagnostics(string assemblyName)
    {
        return Assembly.Load(assemblyName);
    }
}
