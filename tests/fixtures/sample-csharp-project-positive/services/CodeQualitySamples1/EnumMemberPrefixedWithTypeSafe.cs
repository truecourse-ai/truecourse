namespace Positive.Boundary.CodeQuality;

/// <summary>
/// Holds an enum whose member starts with the same letters as the type name but
/// does not begin a new PascalCase word after the prefix. The rule only fires
/// when stripping the exact type-name prefix leaves a valid PascalCase
/// identifier, so <c>Colorful</c> on <c>Color</c> must not fire.
/// </summary>
public static class EnumMemberPrefixedWithTypeSafe
{
    /// <summary>Rendering tones, none of which redundantly repeat the type name.</summary>
    public enum Color
    {
        None = 0,
        // SAFE: code-quality/deterministic/enum-member-prefixed-with-type
        Colorful = 1,
        Muted = 2,
    }
}
