namespace Positive.Boundary.CodeQuality;

/// <summary>
/// A switch whose sections each have a distinct body. Two sections sharing a
/// lone <c>break;</c> are too trivial to count, so the duplicate-section rule
/// must not fire.
/// </summary>
public class DuplicateSwitchSectionBodiesSafe
{
    /// <summary>Maps a status code to a label.</summary>
    internal string Label(int code)
    {
        var result = "unknown";
        // SAFE: code-quality/deterministic/duplicate-switch-section-bodies
        switch (code)
        {
            case 0:
                result = "idle";
                break;
            case 1:
                result = "running";
                break;
            default:
                result = "other";
                break;
        }
        return result;
    }
}
