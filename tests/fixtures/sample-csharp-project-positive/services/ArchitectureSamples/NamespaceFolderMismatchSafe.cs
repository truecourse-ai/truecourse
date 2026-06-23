namespace Positive.Boundary.Architecture;

/// <summary>
/// Sits under Boundary/Architecture and its namespace ends with those exact
/// folder segments after a deliberate company root, so the folder convention holds.
/// </summary>
// SAFE: architecture/deterministic/namespace-folder-mismatch
public sealed class NamespaceFolderMismatchSafe
{
    /// <summary>Returns the namespace tail the file lives under.</summary>
    internal string FolderTail() => "Boundary.Architecture";
}
