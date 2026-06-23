namespace Positive.Boundary.CodeQuality;

/// <summary>Returns a coordinate pair using C# tuple syntax.</summary>
public sealed class PreferTupleSyntaxSafe
{
    /// <summary>Splits a flat index into row and column components.</summary>
    // SAFE: code-quality/deterministic/prefer-tuple-syntax
    internal (int Row, int Column) Locate(int index, int width)
    {
        return (index / width, index % width);
    }
}
