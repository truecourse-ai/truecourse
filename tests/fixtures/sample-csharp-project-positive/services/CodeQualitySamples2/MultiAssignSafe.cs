namespace Positive.Boundary.CodeQuality;

/// <summary>
/// Assigns related values in separate statements rather than chaining them as
/// `a = b = c`, so the multi-assign rule must not fire.
/// </summary>
public class MultiAssignSafe
{
    /// <summary>Sums two seeded counters.</summary>
    public int SeedTotal()
    {
        // SAFE: code-quality/deterministic/multi-assign
        var first = 1;
        var second = first;
        return first + second;
    }
}
