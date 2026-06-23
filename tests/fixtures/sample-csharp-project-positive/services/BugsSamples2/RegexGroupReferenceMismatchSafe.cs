using System.Text.RegularExpressions;

namespace Positive.Boundary.Bugs;

/// <summary>Rewrites "user@host" pairs, keeping both captured halves.</summary>
public sealed class RegexGroupReferenceMismatchSafe
{
    /// <summary>Returns the input with each address normalised to "user@host".</summary>
    internal string NormalizeUserDomains(string input)
    {
        // SAFE: bugs/deterministic/regex-group-reference-mismatch
        return Regex.Replace(input, @"(\w+)@(\w+)", "$1@$2");
    }
}
