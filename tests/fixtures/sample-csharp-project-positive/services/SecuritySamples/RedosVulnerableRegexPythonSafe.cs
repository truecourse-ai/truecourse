using System.Text.RegularExpressions;

namespace Positive.Boundary.Security;

/// <summary>Compiles a nested-quantifier pattern under the non-backtracking engine, which cannot blow up.</summary>
public sealed class RedosVulnerableRegexPythonSafe
{
    /// <summary>Returns a regex for the pattern that opts out of catastrophic backtracking.</summary>
    internal Regex BuildMatcher()
    {
        // SAFE: security/deterministic/redos-vulnerable-regex-python
        return new Regex("(a+)+", RegexOptions.NonBacktracking);
    }
}
