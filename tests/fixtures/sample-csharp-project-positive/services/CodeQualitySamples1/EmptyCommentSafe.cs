namespace Positive.Boundary.CodeQuality;

/// <summary>
/// A comment that consists only of a run of dashes is a deliberate visual
/// divider, which the empty-comment rule excludes. The rule must not fire.
/// </summary>
public class EmptyCommentSafe
{
    /// <summary>Returns the supplied value unchanged.</summary>
    internal int Passthrough(int value)
    {
        // SAFE: code-quality/deterministic/empty-comment
        // --------
        return value;
    }
}
