using System.Diagnostics;

namespace Positive.Boundary.CodeQuality;

/// <summary>Uses Debug.Assert with a real condition rather than a constant false.</summary>
public sealed class DebugAssertFalseSafe
{
    // SAFE: code-quality/deterministic/debug-assert-false
    /// <summary>Asserts the count is non-negative before returning it.</summary>
    internal int Validate(int count)
    {
        Debug.Assert(count >= 0, "count must be non-negative");
        return count;
    }
}
