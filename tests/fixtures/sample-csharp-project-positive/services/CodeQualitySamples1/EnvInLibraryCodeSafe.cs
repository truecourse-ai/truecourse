using System.Collections;

namespace Positive.Boundary.CodeQuality;

/// <summary>
/// Library code that touches <c>Environment</c> but reads the full snapshot via
/// <c>GetEnvironmentVariables()</c> rather than the singular
/// <c>GetEnvironmentVariable</c> the rule targets. Same receiver, different
/// method, so the rule must not fire.
/// </summary>
public sealed class EnvInLibraryCodeSafe
{
    /// <summary>Returns how many environment variables are currently defined.</summary>
    public int DefinedVariableCount()
    {
        // SAFE: code-quality/deterministic/env-in-library-code
        IDictionary snapshot = System.Environment.GetEnvironmentVariables();
        return snapshot.Count;
    }
}
