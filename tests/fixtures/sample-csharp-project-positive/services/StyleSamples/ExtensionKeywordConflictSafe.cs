namespace Positive.Boundary.Style;

/// <summary>A member that keeps the name 'extension' but escapes it.</summary>
internal sealed class ExtensionKeywordConflictSafe
{
    // SAFE: style/deterministic/extension-keyword-conflict
    internal int @extension { get; set; } = 1;
}
