namespace Positive.Boundary.Style;

/// <summary>Documented public type at the docstring boundary.</summary>
public sealed class DocstringCompletenessSafe
{
    // SAFE: style/deterministic/docstring-completeness
    /// <summary>Returns the configured retry budget.</summary>
    public int RetryBudget() => 3;
}
