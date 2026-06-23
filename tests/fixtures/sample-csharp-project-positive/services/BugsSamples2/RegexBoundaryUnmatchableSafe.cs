using System.Text.RegularExpressions;

namespace Positive.Boundary.Bugs;

/// <summary>Matches a line that is exactly the literal word "report".</summary>
public sealed class RegexBoundaryUnmatchableSafe
{
    /// <summary>Reports whether the whole line is anchored to the word "report".</summary>
    internal bool IsReportLine(string line)
    {
        // SAFE: bugs/deterministic/regex-boundary-unmatchable
        return Regex.IsMatch(line, @"^\breport\b$");
    }
}
