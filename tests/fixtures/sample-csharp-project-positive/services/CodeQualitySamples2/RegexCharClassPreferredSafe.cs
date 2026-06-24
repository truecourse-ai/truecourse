using System.Text.RegularExpressions;

namespace Positive.Boundary.CodeQuality;

/// <summary>
/// Uses a reluctant <c>.*?</c> under Singleline mode, where <c>.</c> spans
/// newlines and a negated character class would change the meaning. The
/// char-class-preferred rule must not fire in Singleline mode.
/// </summary>
public class RegexCharClassPreferredSafe
{
    /// <summary>Extracts the note block from <paramref name="html"/>.</summary>
    public string ExtractNote(string html)
    {
        // SAFE: code-quality/deterministic/regex-char-class-preferred
        return Regex.Match(html, "<note>.*?</note>", RegexOptions.Singleline).Value;
    }
}
