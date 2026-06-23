namespace Positive.Boundary.CodeQuality;

/// <summary>
/// A null-check ternary whose non-null branch transforms the tested value
/// (<c>requested.Trim()</c>) rather than returning it verbatim, so it does not
/// restate the <c>??</c> operator and the rule must not fire.
/// </summary>
public class UseNullCoalescingSafe
{
    /// <summary>Returns the trimmed requested host, or a fallback when none was given.</summary>
    public string Resolve(string requested, string fallback)
    {
        // SAFE: code-quality/deterministic/use-null-coalescing
        return requested != null ? requested.Trim() : fallback;
    }
}
