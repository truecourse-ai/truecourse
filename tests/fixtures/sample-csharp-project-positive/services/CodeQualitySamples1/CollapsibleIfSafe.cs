namespace Positive.Boundary.CodeQuality;

/// <summary>
/// A nested if whose outer if also has an else branch, so the two conditions
/// cannot be merged with &amp;&amp; and the collapsible-if rule must not fire.
/// </summary>
public class CollapsibleIfSafe
{
    /// <summary>Classifies a score, keeping the else branch that blocks collapsing.</summary>
    public string Classify(int score, int threshold)
    {
        // SAFE: code-quality/deterministic/collapsible-if
        if (score > threshold)
        {
            if (score > 0)
            {
                return "high";
            }
        }
        else
        {
            return "low";
        }

        return "none";
    }
}
