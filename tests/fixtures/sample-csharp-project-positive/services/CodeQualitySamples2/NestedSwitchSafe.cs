namespace Positive.Boundary.CodeQuality;

/// <summary>
/// Two switch statements that run one after another rather than one inside the
/// other, so the nested-switch rule must not fire.
/// </summary>
public class NestedSwitchSafe
{
    /// <summary>Maps a code and a tier to a combined label.</summary>
    public string Describe(int code, int tier)
    {
        var prefix = "x";
        // SAFE: code-quality/deterministic/nested-switch
        switch (code)
        {
            case 0:
                prefix = "zero";
                break;
            case 1:
                prefix = "one";
                break;
            default:
                prefix = "many";
                break;
        }

        var suffix = "x";
        switch (tier)
        {
            case 1:
                suffix = "low";
                break;
            case 2:
                suffix = "mid";
                break;
            default:
                suffix = "high";
                break;
        }

        return $"{prefix}-{suffix}";
    }
}
