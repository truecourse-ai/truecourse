namespace Positive.Boundary.CodeQuality;

/// <summary>
/// A raw string literal whose content contains a double quote, which a regular
/// literal would have to escape, so the raw form earns its weight. The
/// unnecessary-raw-string rule must not fire.
/// </summary>
public class UnnecessaryRawStringSafe
{
    /// <summary>A header that embeds a quoted phrase.</summary>
    // SAFE: code-quality/deterministic/unnecessary-raw-string
    public string Header => """Daily "Live" Report""";
}
