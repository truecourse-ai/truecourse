using System.Text.RegularExpressions;

namespace Positive.Boundary.Bugs;

/// <summary>Detects lines whose first word is immediately repeated.</summary>
public sealed class UselessBackreferenceSafe
{
    /// <summary>True when a word is followed by a hyphen and the same word again.</summary>
    internal bool HasRepeatedWord(string line)
    {
        // SAFE: bugs/deterministic/useless-backreference
        return Regex.IsMatch(line, @"(\w+)-\1");
    }
}
