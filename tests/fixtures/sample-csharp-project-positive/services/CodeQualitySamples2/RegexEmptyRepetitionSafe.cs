using System.Text.RegularExpressions;

namespace Positive.Boundary.CodeQuality;

/// <summary>
/// A repeated group whose inner atom is mandatory (no optional or starred
/// content), so the group can never match the empty string and there is no
/// catastrophic-backtracking risk.
/// </summary>
public class RegexEmptyRepetitionSafe
{
    /// <summary>Reports whether <paramref name="payload"/> has a repeated segment.</summary>
    public bool HasRepeatedSegment(string payload)
    {
        // SAFE: code-quality/deterministic/regex-empty-repetition
        var segmentPattern = new Regex("(ab)+suffix");
        return segmentPattern.IsMatch(payload);
    }
}
