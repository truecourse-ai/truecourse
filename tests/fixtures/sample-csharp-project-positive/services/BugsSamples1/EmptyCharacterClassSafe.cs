using System.Text.RegularExpressions;

namespace Positive.Boundary.Bugs;

/// <summary>Validates a slug against a well-formed character class.</summary>
public sealed class EmptyCharacterClassSafe
{
    /// <summary>Returns true when the slug is lowercase letters and dashes.</summary>
    internal bool IsSlug(string value)
    {
        // SAFE: bugs/deterministic/empty-character-class
        var pattern = new Regex("^[a-z-]+$");
        return pattern.IsMatch(value);
    }
}
