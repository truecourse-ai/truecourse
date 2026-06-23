using System.Text.RegularExpressions;

namespace Positive.Boundary.Bugs;

/// <summary>Scans route tokens with a well-formed .NET regular expression.</summary>
public sealed class InvalidRegexpSafe
{
    // SAFE: bugs/deterministic/invalid-regexp
    private static readonly Regex SegmentPattern = new Regex(@"(\d+)");

    /// <summary>Indicates whether the route contains a numeric segment.</summary>
    internal bool HasNumericSegment(string route)
    {
        return SegmentPattern.IsMatch(route);
    }
}
