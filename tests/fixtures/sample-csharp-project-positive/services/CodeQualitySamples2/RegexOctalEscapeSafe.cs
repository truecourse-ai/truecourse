using System.Text.RegularExpressions;

namespace Positive.Boundary.CodeQuality;

/// <summary>
/// Matches a double-quote byte via an explicit hex escape (<c>\x22</c>) rather
/// than the discouraged <c>\0nn</c> octal form, so the rule must not fire.
/// </summary>
public class RegexOctalEscapeSafe
{
    /// <summary>Reports whether <paramref name="flagLine"/> is a flag assignment.</summary>
    public bool IsFlagAssignment(string flagLine)
    {
        // SAFE: code-quality/deterministic/regex-octal-escape
        return Regex.IsMatch(flagLine, @"^flag\x22set$");
    }
}
