using System.Text.RegularExpressions;

namespace Positive.Boundary.Bugs;

/// <summary>Matches "route" only when it starts with a digit that is also a word char.</summary>
public sealed class RegexLookaheadContradictorySafe
{
    /// <summary>Reports whether the line begins with a digit-led "route" token.</summary>
    internal bool StartsWithRouteDigit(string line)
    {
        // SAFE: bugs/deterministic/regex-lookahead-contradictory
        return Regex.IsMatch(line, @"(?=\d)(?=\w)route");
    }
}
