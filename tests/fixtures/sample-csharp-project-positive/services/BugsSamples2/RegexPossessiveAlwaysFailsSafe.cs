using System.Text.RegularExpressions;

namespace Positive.Boundary.Bugs;

/// <summary>Matches a run of digits atomically, then a literal "x" separator.</summary>
public sealed class RegexPossessiveAlwaysFailsSafe
{
    /// <summary>Reports whether the line holds a digit run followed by an "x".</summary>
    internal bool HasRunThenSeparator(string line)
    {
        // SAFE: bugs/deterministic/regex-possessive-always-fails
        return Regex.IsMatch(line, @"(?>\d+)x");
    }
}
