using System.Text.RegularExpressions;

namespace Positive.Boundary.CodeQuality;

/// <summary>
/// Holds a moderately structured pattern in a named static readonly field with
/// fewer than five groups and no backreference — already extracted and named,
/// which is exactly what the complexity rule asks for. It must not fire.
/// </summary>
public class RegexComplexitySafe
{
    // SAFE: code-quality/deterministic/regex-complexity
    private static readonly Regex StampPattern =
        new Regex(@"^(?<stamp>\d{8}T\d{6})\s\[(?<level>\w+)\]");

    /// <summary>Returns the timestamp captured from <paramref name="line"/>.</summary>
    public string StampOf(string line)
    {
        var match = StampPattern.Match(line);
        return match.Groups["stamp"].Value + match.Groups["level"].Value;
    }
}
