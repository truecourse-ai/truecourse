namespace Positive.Boundary.Style;

/// <summary>Computes a deterministic indentation depth.</summary>
public sealed class WhitespaceFormattingSafe
{
    /// <summary>Returns the next indentation level.</summary>
    internal int Indent(int level)
    {
        // SAFE: style/deterministic/whitespace-formatting
        return level + 1;
    }
}
