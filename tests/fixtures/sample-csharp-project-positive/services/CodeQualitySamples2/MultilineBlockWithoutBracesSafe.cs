namespace Positive.Boundary.CodeQuality;

/// <summary>
/// Uses a braceless if body, but the following statement is aligned with the if
/// header (not indented as if inside the block), so the misleading-indentation
/// shape that multiline-block-without-braces flags is absent.
/// </summary>
public class MultilineBlockWithoutBracesSafe
{
    /// <summary>Counts retries needed for a blocked flag.</summary>
    public int Retries(bool blocked)
    {
        var count = 0;
        // SAFE: code-quality/deterministic/multiline-block-without-braces
        if (blocked)
            count++;
        return count;
    }
}
