using System.Text.RegularExpressions;

namespace Positive.Boundary.Bugs;

/// <summary>Detects a four-digit year repeated verbatim after a hyphen.</summary>
public sealed class RegexBackreferenceInvalidSafe
{
    /// <summary>Reports whether the year before the hyphen is echoed after it.</summary>
    internal bool HasMirroredYearSuffix(string line)
    {
        // SAFE: bugs/deterministic/regex-backreference-invalid
        return Regex.IsMatch(line, @"(\d{4})-\1");
    }
}
