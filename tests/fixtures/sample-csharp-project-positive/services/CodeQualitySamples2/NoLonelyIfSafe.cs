namespace Positive.Boundary.CodeQuality;

/// <summary>
/// An <c>else if</c> chain. The no-lonely-if rule only flags an <c>if</c> that
/// is wrapped in its own <c>else { … }</c> block; the collapsed <c>else if</c>
/// form is the fix and must not fire.
/// </summary>
public sealed class NoLonelyIfSafe
{
    /// <summary>Maps a positive/zero/negative input to 1, 0, or -1.</summary>
    internal int Classify(int value)
    {
        if (value > 0)
        {
            return 1;
        }
        // SAFE: code-quality/deterministic/no-lonely-if
        else if (value < 0)
        {
            return -1;
        }

        return 0;
    }
}
