namespace Positive.Boundary.Bugs;

/// <summary>
/// Lowercasing the result of a non-string <c>ToString()</c> serializes a value to
/// a lowercase token (a bool's <c>"true"</c>/<c>"false"</c>, a lowercase enum
/// name) where lowercase is the intended output, not text normalization.
/// normalize-to-lower-not-upper must not fire on these. <c>ToLowerInvariant</c> is
/// used so the fold is culture-independent.
/// </summary>
public sealed class NormalizeToLowerSerializationSafe
{
    /// <summary>Serializes a bool to a lowercase config token.</summary>
    public string RequireHttps(bool value)
    {
        // SAFE: bugs/deterministic/normalize-to-lower-not-upper
        return value.ToString().ToLowerInvariant();
    }

    /// <summary>Serializes an enum to a lowercase token.</summary>
    public string ModeToken(System.DayOfWeek day)
    {
        // SAFE: bugs/deterministic/normalize-to-lower-not-upper
        return day.ToString().ToLowerInvariant();
    }
}
