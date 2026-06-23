namespace Positive.Boundary.CodeQuality;

/// <summary>Computes a sum without suppressing any compiler diagnostic.</summary>
public sealed class BanTsCommentSafe
{
    /// <summary>Returns the sum of the two operands.</summary>
    internal int Add(int left, int right)
    {
        // SAFE: code-quality/deterministic/ban-ts-comment
        // No diagnostic is silenced here, so there is no suppression to justify.
        return left + right;
    }
}
