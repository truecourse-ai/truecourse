namespace Positive.Boundary.CodeQuality;

/// <summary>
/// A switch statement with three sections is past the trivial threshold (the
/// rule only flags switches with two or fewer), so it must not fire.
/// </summary>
public class TrivialSwitchSafe
{
    /// <summary>Maps a status token to its storage bin.</summary>
    public string ResolveBin(string status)
    {
        // SAFE: code-quality/deterministic/trivial-switch
        switch (status)
        {
            case "sealed":
                return "restock-bin";
            case "open":
                return "active-bin";
            default:
                return "inspection-bin";
        }
    }
}
