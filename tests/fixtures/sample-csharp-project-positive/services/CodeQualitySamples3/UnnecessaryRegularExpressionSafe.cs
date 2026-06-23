using System.Text.RegularExpressions;

namespace Positive.Boundary.CodeQuality;

/// <summary>
/// Uses <c>Regex.IsMatch</c> with a pattern that contains real regex
/// metacharacters, so the regex engine is doing genuine work that
/// <c>string.Contains</c> cannot replicate. The unnecessary-regular-expression
/// rule must not fire.
/// </summary>
public class UnnecessaryRegularExpressionSafe
{
    /// <summary>Reports whether the comment mentions a pending refund amount.</summary>
    public bool MentionsPendingRefund(string comment)
    {
        // SAFE: code-quality/deterministic/unnecessary-regular-expression
        return Regex.IsMatch(comment, @"refund \d+ pending");
    }
}
