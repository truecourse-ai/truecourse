using System.Text.RegularExpressions;

namespace Positive.Boundary.CodeQuality;

/// <summary>
/// A grouped sub-pattern that actually contains an atom and is quantified, so
/// it is neither the literal empty <c>()</c> pair the rule targets nor a
/// superfluous non-capturing group.
/// </summary>
public class RegexEmptyGroupSafe
{
    /// <summary>Reports whether <paramref name="slug"/> is an order slug.</summary>
    public bool IsOrderSlug(string slug)
    {
        // SAFE: code-quality/deterministic/regex-empty-group
        return Regex.IsMatch(slug, @"order(?:\d)+number");
    }
}
