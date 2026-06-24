namespace Positive.Boundary.CodeQuality;

/// <summary>
/// A switch that uses <c>goto case</c> for sanctioned fall-through. The rule
/// flags <c>goto label</c> jumps to arbitrary labels but explicitly excludes
/// <c>goto case</c> / <c>goto default</c>, which are C#'s structured way to
/// chain cases, so it must not fire here. The switch keeps three cases plus a
/// default so it is neither trivial nor missing a default branch.
/// </summary>
public sealed class LabelsUsageSafe
{
    /// <summary>Maps a tier code to its accumulated support weight.</summary>
    public int WeightFor(int tier)
    {
        var weight = 0;
        switch (tier)
        {
            case 3:
                weight += 1;
                goto case 2;
            case 2:
                weight += 1;
                // SAFE: code-quality/deterministic/labels-usage
                goto case 1;
            case 1:
                weight += 1;
                break;
            default:
                weight = 0;
                break;
        }
        return weight;
    }
}
