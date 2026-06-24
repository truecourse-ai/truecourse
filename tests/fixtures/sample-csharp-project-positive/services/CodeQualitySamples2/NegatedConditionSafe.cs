namespace Positive.Boundary.CodeQuality;

/// <summary>
/// A negated <c>if</c> whose else branch is no larger than the consequence, so
/// inverting the branches would not improve readability and the
/// negated-condition rule must not fire.
/// </summary>
public class NegatedConditionSafe
{
    /// <summary>Picks a label, keeping the short guard at the top.</summary>
    public string Classify(bool ready, int value)
    {
        string label;
        // SAFE: code-quality/deterministic/negated-condition
        if (!ready)
        {
            label = "pending";
        }
        else
        {
            label = value > 0 ? "positive" : "zero";
        }

        return label;
    }
}
