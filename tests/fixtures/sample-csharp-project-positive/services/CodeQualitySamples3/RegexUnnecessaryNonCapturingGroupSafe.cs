using System.Text.RegularExpressions;

namespace Positive.Boundary.CodeQuality;

/// <summary>
/// A non-capturing group that wraps an alternation, so the grouping is load
/// bearing — without it the alternation would span the whole pattern.
/// </summary>
public class RegexUnnecessaryNonCapturingGroupSafe
{
    /// <summary>True for a request line that reads users via GET or HEAD.</summary>
    public bool IsReadRoute(string requestLine)
    {
        // SAFE: code-quality/deterministic/regex-unnecessary-non-capturing-group
        return Regex.IsMatch(requestLine, "(?:GET|HEAD) /api/users");
    }
}
