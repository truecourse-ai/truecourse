namespace Positive.Boundary.CodeQuality;

/// <summary>
/// Builds Windows file paths. The verbatim string holds backslashes, so the
/// `@` prefix is doing real work and the rule must not fire.
/// </summary>
public sealed class UnnecessaryVerbatimStringSafe
{
    /// <summary>Returns the root directory for cached report files.</summary>
    internal string CacheRoot()
    {
        // SAFE: code-quality/deterministic/unnecessary-verbatim-string
        return @"C:\data\reports\cache";
    }
}
