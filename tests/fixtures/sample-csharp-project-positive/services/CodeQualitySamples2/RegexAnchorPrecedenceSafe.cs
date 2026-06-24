using System.Text.RegularExpressions;

namespace Positive.Boundary.CodeQuality;

/// <summary>
/// Anchors an alternation correctly by wrapping it in a group, so both <c>^</c>
/// and <c>$</c> apply to every branch. The anchor-precedence rule must not fire
/// when the alternatives are anchored consistently.
/// </summary>
public class RegexAnchorPrecedenceSafe
{
    /// <summary>Tests whether <paramref name="channel"/> is cash or card.</summary>
    public bool IsTenderChannel(string channel)
    {
        // SAFE: code-quality/deterministic/regex-anchor-precedence
        return Regex.IsMatch(channel, "^(cash|card)$");
    }
}
