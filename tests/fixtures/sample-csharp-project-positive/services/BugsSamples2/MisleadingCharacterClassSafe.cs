using System.Text.RegularExpressions;

namespace Positive.Boundary.Bugs;

/// <summary>Detects a thumbs-up emoji by matching it outside a character class.</summary>
public sealed class MisleadingCharacterClassSafe
{
    /// <summary>True when the comment contains a thumbs-up reaction.</summary>
    public bool HasThumbsUp(string comment)
    {
        // SAFE: bugs/deterministic/misleading-character-class
        return Regex.IsMatch(comment, "👍+");
    }
}
