using System.Diagnostics.CodeAnalysis;

namespace Positive.Boundary.CodeQuality;

/// <summary>Carries a documented analyzer suppression with a recorded justification.</summary>
public sealed class SuppressionWithoutJustificationSafe
{
    /// <summary>Render the route summary as a plain string.</summary>
    // SAFE: code-quality/deterministic/suppression-without-justification
    [SuppressMessage("Performance", "CA1822", Justification = "Kept instance-level for API stability.")]
    public string Summarize(string route)
    {
        return "route: " + route;
    }
}
