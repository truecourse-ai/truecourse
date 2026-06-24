namespace Positive.Boundary.CodeQuality;

/// <summary>
/// An <c>else</c> branch whose body is empty except for a comment documenting
/// why nothing happens. The empty-else-clause rule treats that as intentional
/// and must not fire.
/// </summary>
public class EmptyElseClauseSafe
{
    /// <summary>Returns 1 when the input is positive, otherwise 0.</summary>
    internal int Sign(int value)
    {
        var result = 0;
        if (value > 0)
        {
            result = 1;
        }
        // SAFE: code-quality/deterministic/empty-else-clause
        else
        {
            // Non-positive inputs deliberately keep the default result.
        }
        return result;
    }
}
