namespace Positive.Boundary.CodeQuality;

/// <summary>
/// A switch statement that already carries a default section, so the
/// missing-default rule must not fire. Three sections keep it past the
/// trivial-switch threshold.
/// </summary>
public class DefaultCaseInSwitchSafe
{
    /// <summary>Maps a trailer type to its dock door.</summary>
    public string ResolveDoor(string trailerType)
    {
        var door = "door-zero";
        // SAFE: code-quality/deterministic/default-case-in-switch
        switch (trailerType)
        {
            case "reefer":
                door = "cold-door";
                break;
            case "flatbed":
                door = "side-door";
                break;
            default:
                door = "general-door";
                break;
        }

        return door;
    }
}
