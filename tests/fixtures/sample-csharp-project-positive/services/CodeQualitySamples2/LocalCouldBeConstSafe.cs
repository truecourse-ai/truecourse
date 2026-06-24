namespace Positive.Boundary.CodeQuality;

/// <summary>
/// A local initialized with a constant but later reassigned. The rule only
/// flags a constant-initialized local that is NEVER reassigned (so it could be
/// <c>const</c>); because this one is mutated, <c>const</c> would be illegal and
/// the rule must not fire.
/// </summary>
public sealed class LocalCouldBeConstSafe
{
    /// <summary>Accumulates a weighted step count.</summary>
    public int Accumulate(int rounds)
    {
        // SAFE: code-quality/deterministic/local-could-be-const
        int step = 1;
        for (var i = 0; i < rounds; i++)
        {
            step = (i + 1) * step;
        }
        return step;
    }
}
