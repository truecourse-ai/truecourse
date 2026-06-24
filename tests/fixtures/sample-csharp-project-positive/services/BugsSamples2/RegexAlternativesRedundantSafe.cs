using System.Text.RegularExpressions;

namespace Positive.Boundary.Bugs;

/// <summary>Classifies a log line by the severity keyword it begins with.</summary>
public sealed class RegexAlternativesRedundantSafe
{
    /// <summary>Reports whether the line starts with a recognised severity keyword.</summary>
    internal bool HasSeverity(string line)
    {
        // SAFE: bugs/deterministic/regex-alternatives-redundant
        return Regex.IsMatch(line, "^(warn|error|info)");
    }
}
