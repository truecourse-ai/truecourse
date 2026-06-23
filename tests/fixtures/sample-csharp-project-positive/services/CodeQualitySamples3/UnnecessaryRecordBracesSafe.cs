namespace Positive.Boundary.CodeQuality;

/// <summary>
/// A positional record whose <c>{ }</c> body actually declares a member, so the
/// braces are not empty noise. The unnecessary-record-braces rule must not fire.
/// </summary>
// SAFE: code-quality/deterministic/unnecessary-record-braces
public record UnnecessaryRecordBracesSafe(string Method, string Path)
{
    /// <summary>The combined route key.</summary>
    public string Key => $"{Method} {Path}";
}
