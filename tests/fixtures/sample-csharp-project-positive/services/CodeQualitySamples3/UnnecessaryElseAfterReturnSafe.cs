namespace Positive.Boundary.CodeQuality;

/// <summary>
/// An if/else whose consequence does not end with a return, so the else branch is
/// genuinely needed for control flow. The unnecessary-else-after-return check only
/// fires when the if branch returns, so this form must not fire.
/// </summary>
public class UnnecessaryElseAfterReturnSafe
{
    /// <summary>Accumulates into a running total based on the sign of the amount.</summary>
    public int Apply(int total, int amount)
    {
        // SAFE: code-quality/deterministic/unnecessary-else-after-return
        var result = total;
        if (amount > 0)
        {
            result += amount;
        }
        else
        {
            result -= amount;
        }

        return result;
    }
}
