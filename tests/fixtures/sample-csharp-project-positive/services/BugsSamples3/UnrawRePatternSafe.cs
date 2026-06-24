using System.Text.RegularExpressions;

namespace Positive.Boundary.Bugs;

/// <summary>Matches a version token using a verbatim regex so the word boundaries are real.</summary>
internal sealed class UnrawRePatternSafe
{
    // SAFE: bugs/deterministic/unraw-re-pattern
    private static readonly Regex VersionTokenPattern = new Regex(@"\bv\d+\b");

    internal bool HasVersionToken(string route)
    {
        return VersionTokenPattern.IsMatch(route);
    }
}
