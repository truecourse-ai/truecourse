using System.Text.RegularExpressions;

namespace Positive.Boundary.CodeQuality;

/// <summary>
/// A reluctant quantifier followed directly by a literal that must match, so
/// the lazy part cannot collapse to zero repetitions. The rule only fires when
/// the reluctant atom is followed by another optional atom.
/// </summary>
public class RegexEmptyAfterReluctantSafe
{
    /// <summary>Finds the terms clause inside <paramref name="body"/>.</summary>
    public string FindTermsClause(string body)
    {
        // SAFE: code-quality/deterministic/regex-empty-after-reluctant
        return Regex.Match(body, @"\w+?terms").Value;
    }
}
