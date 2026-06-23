using System.Text.RegularExpressions;

namespace Positive.Boundary.CodeQuality;

/// <summary>
/// A pattern with a single literal space separating the label from the digits.
/// The rule only flags two or more consecutive spaces outside a character
/// class, so a lone space must not fire it.
/// </summary>
public class RegexMultipleSpacesSafe
{
    /// <summary>Reports whether <paramref name="header"/> is an aligned report header.</summary>
    public bool IsAlignedReportHeader(string header)
    {
        // SAFE: code-quality/deterministic/regex-multiple-spaces
        return Regex.IsMatch(header, @"report: \d+");
    }
}
