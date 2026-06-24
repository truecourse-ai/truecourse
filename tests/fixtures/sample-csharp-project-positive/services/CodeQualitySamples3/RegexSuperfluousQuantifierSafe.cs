using System.Text.RegularExpressions;

namespace Positive.Boundary.CodeQuality;

/// <summary>
/// A bounded `{1,2}` repetition, which is a real range — only the no-op `{1}`
/// quantifier is superfluous, so this pattern must not fire.
/// </summary>
public class RegexSuperfluousQuantifierSafe
{
    /// <summary>True for a version tag whose minor part is one or two digits.</summary>
    public bool IsVersionTag(string version)
    {
        // SAFE: code-quality/deterministic/regex-superfluous-quantifier
        return Regex.IsMatch(version, @"v\d+\.\d{1,2}");
    }
}
