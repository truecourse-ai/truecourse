namespace Positive.Boundary.CodeQuality;

/// <summary>
/// A numeric literal used inside an arithmetic expression, but the expression
/// defines a named <c>const</c>. The literal IS the named constant being
/// declared, so the rule must not fire — it skips const-declaration context.
/// </summary>
public sealed class MagicNumberSafe
{
    // SAFE: code-quality/deterministic/magic-number
    private const int RetryBudgetMillis = 250 * 3;

    /// <summary>Returns the configured retry budget in milliseconds.</summary>
    internal int GetRetryBudget()
    {
        return RetryBudgetMillis;
    }
}
