namespace Positive.Boundary.CodeQuality;

/// <summary>
/// A top-level type declared inside a file-scoped namespace, so it does not
/// land in the global namespace and the rule must not fire.
/// </summary>
// SAFE: code-quality/deterministic/type-in-global-namespace
public class TypeInGlobalNamespaceSafe
{
    /// <summary>The reason this marker was recorded.</summary>
    public string Reason { get; set; } = string.Empty;
}
