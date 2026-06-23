namespace Positive.Boundary.CodeQuality;

/// <summary>Declares a local that an intervening statement computes before its assignment.</summary>
public sealed class MergeDeclarationWithAssignmentSafe
{
    /// <summary>Returns the doubled length of the trimmed input.</summary>
    internal int Measure(string input)
    {
        // SAFE: code-quality/deterministic/merge-declaration-with-assignment
        int length;
        var trimmed = input.Trim();
        length = trimmed.Length * 2;
        return length;
    }
}
