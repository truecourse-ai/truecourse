namespace Positive.Boundary.CodeQuality;

/// <summary>
/// An intentional infinite loop written in the canonical while (true) form, which is
/// exactly the spelling the rule recommends, so infinite-loop-non-canonical must not
/// fire. A break keeps the loop terminating and the body non-trivial.
/// </summary>
public class InfiniteLoopNonCanonicalSafe
{
    /// <summary>Advances a counter until it reaches the supplied limit, then stops.</summary>
    public int CountUpTo(int limit)
    {
        var ticks = 0;

        // SAFE: code-quality/deterministic/infinite-loop-non-canonical
        while (true)
        {
            if (ticks >= limit)
            {
                break;
            }

            ticks += 1;
        }

        return ticks;
    }
}
