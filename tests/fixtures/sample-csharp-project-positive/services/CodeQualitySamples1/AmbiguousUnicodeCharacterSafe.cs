namespace Positive.Boundary.CodeQuality;

/// <summary>Formats a status code into a human-readable label.</summary>
public sealed class AmbiguousUnicodeCharacterSafe
{
    /// <summary>Returns a label string for the given status name.</summary>
    internal string Describe(string code)
    {
        // SAFE: code-quality/deterministic/ambiguous-unicode-character
        var statusLabel = code.Trim();
        return $"status {statusLabel}";
    }
}
