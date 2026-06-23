using System.Text.RegularExpressions;

namespace Positive.Boundary.CodeQuality;

/// <summary>
/// Uses a character class whose members are all distinct, so there is no
/// redundant character to remove. The duplicate-char-class rule must not fire.
/// </summary>
public class RegexDuplicateCharClassSafe
{
    /// <summary>Tests whether <paramref name="vowelToken"/> is all vowels.</summary>
    public bool HasVowelRun(string vowelToken)
    {
        // SAFE: code-quality/deterministic/regex-duplicate-char-class
        return Regex.IsMatch(vowelToken, "[aeiou]+");
    }
}
