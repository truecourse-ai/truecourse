using System.Text.RegularExpressions;

namespace Positive.Boundary.CodeQuality;

/// <summary>
/// A pattern with exactly two unnamed capture groups, one below the three-capture
/// threshold at which unnamed-regex-capture fires. Two positional groups are still
/// easy to read, so the check must not fire.
/// </summary>
public class UnnamedRegexCaptureSafe
{
    /// <summary>Splits a "major.minor" version string into its two numeric parts.</summary>
    public string MajorMinor(string version)
    {
        // SAFE: code-quality/deterministic/unnamed-regex-capture
        var match = Regex.Match(version, @"(\d+)\.(\d+)");
        return $"{match.Groups[1].Value}/{match.Groups[2].Value}";
    }
}
