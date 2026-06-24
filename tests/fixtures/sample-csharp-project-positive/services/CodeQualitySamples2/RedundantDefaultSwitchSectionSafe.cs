namespace Positive.Boundary.CodeQuality;

/// <summary>
/// A switch whose <c>default</c> section carries real behaviour — it returns a
/// value rather than a bare <c>break</c>. The rule only flags a <c>default</c>
/// section whose single statement is <c>break</c>, so it must not fire here.
/// </summary>
public sealed class RedundantDefaultSwitchSectionSafe
{
    /// <summary>Maps a status code to a short human label.</summary>
    public string Describe(int status)
    {
        switch (status)
        {
            case 0:
                return "pending";
            case 1:
                return "active";
            // SAFE: code-quality/deterministic/redundant-default-switch-section
            default:
                return "unknown";
        }
    }
}
