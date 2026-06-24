namespace Positive.Boundary.CodeQuality;

/// <summary>
/// One public top-level type whose name matches the file name. This is the exact
/// shape the rule inspects (single public type, undotted file name) — it must
/// stay quiet because the names agree.
/// </summary>
// SAFE: code-quality/deterministic/filename-class-mismatch
public sealed class FilenameClassMismatchSafe
{
    /// <summary>Returns the entry's label.</summary>
    internal string Describe(string label) => label;
}
