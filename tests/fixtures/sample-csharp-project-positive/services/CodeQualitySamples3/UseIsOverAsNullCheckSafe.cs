namespace Positive.Boundary.CodeQuality;

/// <summary>
/// An <c>as</c> assignment whose result is used before the null check, so the
/// declaration is no longer adjacent to a bare <c>!= null</c> test and the
/// straightforward <c>is</c>-pattern rewrite does not apply.
/// </summary>
public class UseIsOverAsNullCheckSafe
{
    /// <summary>Returns the length of a string-typed payload, or zero otherwise.</summary>
    public int Measure(object source)
    {
        // SAFE: code-quality/deterministic/use-is-over-as-null-check
        var label = source as string;
        var trimmed = label?.Trim();
        if (trimmed != null)
        {
            return trimmed.Length;
        }

        return 0;
    }
}
