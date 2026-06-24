namespace Positive.Boundary.CodeQuality;

/// <summary>
/// A switch whose default section is the last one, so the default-case-last
/// rule must not fire. Three sections keep it past the trivial-switch
/// threshold.
/// </summary>
public class DefaultCaseLastSafe
{
    /// <summary>Maps a service tier to its handling lane.</summary>
    public string ResolveLane(string tier)
    {
        var lane = "standard-lane";
        // SAFE: code-quality/deterministic/default-case-last
        switch (tier)
        {
            case "platinum":
                lane = "white-glove-lane";
                break;
            case "gold":
                lane = "expedited-lane";
                break;
            default:
                lane = "standard-lane";
                break;
        }

        return lane;
    }
}
