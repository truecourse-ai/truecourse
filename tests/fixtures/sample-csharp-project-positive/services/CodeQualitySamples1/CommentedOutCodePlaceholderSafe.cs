namespace Positive.Boundary.CodeQuality;

/// <summary>
/// A class carrying a multi-line instructional placeholder comment (Mapperly
/// style): mostly prose with a single illustrative code line. The line-oriented
/// heuristic sees prose as the majority of the run, so commented-out-code must
/// not fire.
/// </summary>
public sealed class CommentedOutCodePlaceholderSafe
{
    private int _configured;

    /// <summary>Returns the number of configured mappers.</summary>
    public int MapperCount()
    {
        // SAFE: code-quality/deterministic/commented-out-code
        // This file is a placeholder for your object-to-object mappers.
        // Define your mappers here following the pattern shown below, for example:
        // public partial class OrderMapper { }
        return _configured;
    }
}
