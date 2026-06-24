namespace Positive.Boundary.CodeQuality;

/// <summary>
/// A type whose name does not match the simple name of any namespace declared in
/// this compilation, so the type-name-matches-namespace check must not fire. The
/// namespace segments here are Positive, Boundary and CodeQuality; the type name
/// stays distinct from all of them.
/// </summary>
// SAFE: code-quality/deterministic/type-name-matches-namespace
public class TypeNameMatchesNamespaceSafe
{
    /// <summary>Returns the configured label.</summary>
    public string Describe(string label)
    {
        return label;
    }
}
