namespace Positive.Boundary.CodeQuality;

/// <summary>Contract paired with its implementation in the same file.</summary>
internal interface IFilenameContract
{
    /// <summary>Returns the configured label.</summary>
    string Label();
}

// SAFE: code-quality/deterministic/csharp-filename-type-mismatch
/// <summary>One top-level type matches the file name, so the file is well-named.</summary>
public sealed class CsharpFilenameTypeMismatchSafe : IFilenameContract
{
    /// <summary>Returns the configured label.</summary>
    public string Label()
    {
        return "label";
    }
}
