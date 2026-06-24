namespace Positive.Boundary.CodeQuality;

/// <summary>
/// A string.Join call that uses a real separator, so it is genuinely joining
/// (not a disguised Concat) and the concat-over-join rule must not fire.
/// </summary>
public class UseStringConcatOverJoinSafe
{
    /// <summary>Joins <paramref name="segments"/> into a comma-separated list.</summary>
    internal string Combine(string[] segments)
    {
        // SAFE: code-quality/deterministic/use-string-concat-over-join
        return string.Join(", ", segments);
    }
}
