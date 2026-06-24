using System.Text.RegularExpressions;

namespace Positive.Boundary.CodeQuality;

/// <summary>
/// A character class holding a range, not a lone character. Single-char-class
/// only flags `[x]`; a range like `[A-Z]` is a genuine, irreducible class.
/// </summary>
public class RegexSingleCharClassSafe
{
    /// <summary>True when the unit is a sequence of uppercase letters.</summary>
    public bool IsUpperCode(string unit)
    {
        // SAFE: code-quality/deterministic/regex-single-char-class
        return Regex.IsMatch(unit, "[A-Z]+");
    }
}
