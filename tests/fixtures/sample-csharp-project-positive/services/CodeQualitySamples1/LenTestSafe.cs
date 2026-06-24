using System.Collections.Generic;

namespace Positive.Boundary.CodeQuality;

/// <summary>
/// An emptiness test against the O(1) <c>.Count</c> property of a list. The rule
/// flags the LINQ <c>Count()</c> method CALL (which enumerates the sequence) but
/// explicitly leaves the <c>.Count</c> property alone, so this must not fire.
/// </summary>
public sealed class LenTestSafe
{
    private readonly List<string> _warnings = new();

    /// <summary>True when no warnings have been recorded.</summary>
    public bool HasNoWarnings()
    {
        // SAFE: code-quality/deterministic/len-test
        return _warnings.Count == 0;
    }
}
