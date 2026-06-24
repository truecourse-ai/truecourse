namespace Positive.Boundary.CodeQuality;

/// <summary>
/// A class carrying an ordinary prose explanation comment that reads like
/// documentation, not code, so the commented-out-code heuristic must not fire.
/// </summary>
public class CommentedOutCodeSafe
{
    /// <summary>Returns the discounted price for the given inputs.</summary>
    public decimal Apply(decimal price, decimal rate)
    {
        // SAFE: code-quality/deterministic/commented-out-code
        // The rate represents a fraction subtracted from the original price.
        return price - (price * rate);
    }
}
