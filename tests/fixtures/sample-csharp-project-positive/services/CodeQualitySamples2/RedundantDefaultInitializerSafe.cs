namespace Positive.Boundary.CodeQuality;

/// <summary>
/// A field initialized to a real, non-default value. The rule only flags
/// initializers that restate the type's default (<c>0</c>, <c>null</c>,
/// <c>false</c>, <c>default</c>); a meaningful starting value is not redundant,
/// so the rule must not fire.
/// </summary>
public sealed class RedundantDefaultInitializerSafe
{
    /// <summary>The default retry budget, deliberately non-zero.</summary>
    // SAFE: code-quality/deterministic/redundant-default-initializer
    private readonly int _maxRetries = 3;

    /// <summary>The configured retry budget for this instance.</summary>
    public int MaxRetries => _maxRetries;
}
