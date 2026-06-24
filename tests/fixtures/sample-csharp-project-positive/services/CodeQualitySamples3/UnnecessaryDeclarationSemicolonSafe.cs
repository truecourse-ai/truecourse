namespace Positive.Boundary.CodeQuality;

/// <summary>
/// A type declaration whose body closes with a plain brace and no trailing
/// semicolon. The unnecessary-declaration-semicolon check fires only when a `;`
/// follows the closing brace, so the idiomatic form here must not fire.
/// </summary>
// SAFE: code-quality/deterministic/unnecessary-declaration-semicolon
public class UnnecessaryDeclarationSemicolonSafe
{
    /// <summary>Returns a fixed tier value.</summary>
    public int Tier => 1;
}
