namespace Positive.Boundary.CodeQuality;

/// <summary>
/// A two-argument <c>Substring</c> whose length is an independent count, not
/// <c>s.Length - start</c>. It does not reach to the end of the string, so the
/// length argument is meaningful and the rule must not fire.
/// </summary>
public sealed class RedundantLengthArgumentSafe
{
    /// <summary>Returns the fixed-width prefix starting at <paramref name="start"/>.</summary>
    public string Window(string text, int start, int count)
    {
        // SAFE: code-quality/deterministic/redundant-length-argument
        return text.Substring(start, count);
    }
}
