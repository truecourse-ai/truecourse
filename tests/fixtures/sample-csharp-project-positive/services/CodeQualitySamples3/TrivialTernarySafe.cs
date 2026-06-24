namespace Positive.Boundary.CodeQuality;

/// <summary>
/// A conditional expression that selects between two real values (not the
/// redundant <c>true</c>/<c>false</c> literals the rule flags), so it must not
/// fire.
/// </summary>
public class TrivialTernarySafe
{
    /// <summary>Picks a tier label from the queue depth.</summary>
    public string ResolveTier(int queueDepth)
    {
        // SAFE: code-quality/deterministic/trivial-ternary
        return queueDepth > 0 ? "busy" : "idle";
    }
}
