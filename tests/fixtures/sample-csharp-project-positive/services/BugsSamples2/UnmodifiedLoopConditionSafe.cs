namespace Positive.Boundary.Bugs;

/// <summary>Estimates a wait time by draining a remaining counter step by step.</summary>
public sealed class UnmodifiedLoopConditionSafe
{
    /// <summary>The condition variable is decremented in the body, so the loop makes progress.</summary>
    internal int EstimateWait(int remaining, int step)
    {
        var total = 0;
        var left = remaining;
        // SAFE: bugs/deterministic/unmodified-loop-condition
        while (left > 0)
        {
            total += step;
            left -= step;
        }
        return total;
    }
}
