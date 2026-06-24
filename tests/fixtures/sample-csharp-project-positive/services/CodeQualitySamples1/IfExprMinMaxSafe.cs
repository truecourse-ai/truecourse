namespace Positive.Boundary.CodeQuality;

/// <summary>
/// A conditional expression whose condition is a comparison — the trigger shape — but
/// whose result branches are unrelated values rather than the compared operands. It
/// does not compute a min or max, so the rule must not fire.
/// </summary>
public sealed class IfExprMinMaxSafe
{
    /// <summary>The label returned when usage is at or under the quota.</summary>
    private readonly string _withinLabel = "within";

    /// <summary>Picks a tier label based on whether usage exceeds the quota.</summary>
    internal string TierFor(int usage, int quota)
    {
        // SAFE: code-quality/deterministic/if-expr-min-max
        return usage > quota ? "over" : _withinLabel;
    }
}
