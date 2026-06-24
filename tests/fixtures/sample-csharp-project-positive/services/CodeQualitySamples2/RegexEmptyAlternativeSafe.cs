using System.Text.RegularExpressions;

namespace Positive.Boundary.CodeQuality;

/// <summary>
/// An alternation where every branch carries a real pattern — no leading,
/// trailing, or doubled <c>|</c>, so no branch matches the empty string and
/// the rule must not fire.
/// </summary>
public class RegexEmptyAlternativeSafe
{
    /// <summary>Reports whether <paramref name="tender"/> is a known tender.</summary>
    public bool IsKnownTender(string tender)
    {
        // SAFE: code-quality/deterministic/regex-empty-alternative
        return Regex.IsMatch(tender, "cash|card");
    }
}
