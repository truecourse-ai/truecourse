using System.Text.RegularExpressions;

namespace Positive.Boundary.CodeQuality;

/// <summary>
/// Single-character options expressed as a character class <c>[ynq]</c> rather
/// than an alternation <c>(y|n|q)</c>, which is exactly the form the rule asks
/// for, so it must not fire.
/// </summary>
public class RegexSingleCharAlternationSafe
{
    /// <summary>Reports whether <paramref name="answer"/> is a prompt answer.</summary>
    public bool IsPromptAnswer(string answer)
    {
        // SAFE: code-quality/deterministic/regex-single-char-alternation
        return Regex.IsMatch(answer, "[ynq]");
    }
}
