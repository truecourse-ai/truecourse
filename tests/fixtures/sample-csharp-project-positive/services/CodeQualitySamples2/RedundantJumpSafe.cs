namespace Positive.Boundary.CodeQuality;

/// <summary>
/// A <c>continue</c> guarded by an <c>if</c> inside the loop. It skips the rest
/// of the iteration conditionally, so it is real control flow — not a trailing
/// <c>continue</c> of the loop body — and the rule must not fire.
/// </summary>
public sealed class RedundantJumpSafe
{
    /// <summary>Counts the positive values in the sequence.</summary>
    public int CountPositive(int[] values)
    {
        int count = 0;
        foreach (int value in values)
        {
            if (value <= 0)
            {
                // SAFE: code-quality/deterministic/redundant-jump
                continue;
            }

            count++;
        }

        return count;
    }
}
