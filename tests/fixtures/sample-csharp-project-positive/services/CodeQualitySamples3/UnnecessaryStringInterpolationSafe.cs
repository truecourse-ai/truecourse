namespace Positive.Boundary.CodeQuality;

/// <summary>
/// An interpolated string whose single hole wraps a non-string value, so the
/// interpolation performs a real conversion rather than reproducing an existing
/// string. The unnecessary-string-interpolation rule must not fire.
/// </summary>
public class UnnecessaryStringInterpolationSafe
{
    private readonly int _count;

    /// <summary>Renders the current count.</summary>
    // SAFE: code-quality/deterministic/unnecessary-string-interpolation
    public string Rendered => $"{_count}";
}
