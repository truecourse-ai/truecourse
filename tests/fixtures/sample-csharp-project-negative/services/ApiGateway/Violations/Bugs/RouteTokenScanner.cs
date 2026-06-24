using System.Text.RegularExpressions;

namespace ApiGateway.Violations.Bugs;

internal class RouteTokenScanner
{
    // VIOLATION: bugs/deterministic/invalid-regexp
    private static readonly Regex OpenSegmentPattern = new Regex(@"(\d+");

    // VIOLATION: bugs/deterministic/empty-character-class
    private static readonly Regex ReservedCharsPattern = new Regex("[]");

    // VIOLATION: bugs/deterministic/control-chars-in-regex
    // VIOLATION: bugs/deterministic/literal-control-character
    private static readonly Regex RecordSeparatorPattern = new Regex("idname");

    // VIOLATION: bugs/deterministic/unraw-re-pattern
    private static readonly Regex VersionTokenPattern = new Regex("\bv\\d+\b");

    internal bool HasLegacyMarkers(string route)
    {
        if (OpenSegmentPattern.IsMatch(route) || ReservedCharsPattern.IsMatch(route))
        {
            return true;
        }
        return RecordSeparatorPattern.IsMatch(route) || VersionTokenPattern.IsMatch(route);
    }

    internal bool MentionsRetryKeyword(string line)
    {
        // VIOLATION: bugs/deterministic/regex-alternatives-redundant
        return Regex.IsMatch(line, "timeout|retry|timeout");
    }

    internal bool HasReportAnchor(string line)
    {
        // VIOLATION: bugs/deterministic/regex-boundary-unmatchable
        // VIOLATION: code-quality/deterministic/unnecessary-verbatim-string
        return Regex.IsMatch(line, @"^report$id");
    }

    internal bool StartsWithRouteDigit(string line)
    {
        // VIOLATION: bugs/deterministic/regex-lookahead-contradictory
        return Regex.IsMatch(line, @"(?=\d)(?!\d)route");
    }

    internal bool EndsWithRunLength(string line)
    {
        // VIOLATION: bugs/deterministic/regex-possessive-always-fails
        return Regex.IsMatch(line, @"(?>\d+)\d");
    }

    internal bool HasMirroredYearSuffix(string line)
    {
        // VIOLATION: bugs/deterministic/regex-backreference-invalid
        return Regex.IsMatch(line, @"(\d{4})-\2");
    }

    internal bool HasEchoedSegment(string line)
    {
        // VIOLATION: bugs/deterministic/useless-backreference
        return Regex.IsMatch(line, @"\1-(\w+)");
    }

    internal bool ContainsReactionBadge(string comment)
    {
        // VIOLATION: bugs/deterministic/misleading-character-class
        return Regex.IsMatch(comment, "[👍]");
    }

    internal string MaskUserDomains(string input)
    {
        // VIOLATION: bugs/deterministic/regex-group-reference-mismatch
        return Regex.Replace(input, @"(\w+)@(\w+)", "$1@$3");
    }
}
