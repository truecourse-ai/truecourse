namespace Positive.Boundary.CodeQuality;

/// <summary>Extends a specific type rather than <c>object</c>, so IntelliSense stays clean.</summary>
public static class ExtensionMethodOnObjectSafe
{
    // SAFE: code-quality/deterministic/extension-method-on-object
    /// <summary>Trims surrounding whitespace from a string value.</summary>
    public static string Tidy(this string value)
    {
        return value.Trim();
    }
}
