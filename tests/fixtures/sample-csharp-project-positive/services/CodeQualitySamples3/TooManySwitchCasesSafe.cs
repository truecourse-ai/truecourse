namespace Positive.Boundary.CodeQuality;

/// <summary>A switch small enough to stay under the case-count threshold.</summary>
public sealed class TooManySwitchCasesSafe
{
    /// <summary>Names a small priority code.</summary>
    internal string Name(int code)
    {
        // SAFE: code-quality/deterministic/too-many-switch-cases
        switch (code)
        {
            case 0: return "none";
            case 1: return "low";
            case 2: return "medium";
            case 3: return "high";
            default: return "unknown";
        }
    }
}
