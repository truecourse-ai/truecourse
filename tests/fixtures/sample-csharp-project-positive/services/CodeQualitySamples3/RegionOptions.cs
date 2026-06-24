namespace Positive.Boundary.CodeQuality;

/// <summary>
/// A configuration/options class that reads an environment variable but
/// coalesces the possibly-null result before dereferencing it, so
/// missing-env-validation must not fire. Reading env here (rather than in
/// library code) is the sanctioned composition-root surface.
/// </summary>
public class RegionOptions
{
    /// <summary>Returns the region length, defaulting when the variable is unset.</summary>
    public int RegionLength()
    {
        // SAFE: code-quality/deterministic/missing-env-validation
        return (System.Environment.GetEnvironmentVariable("APP_REGION") ?? "local").Length;
    }
}
