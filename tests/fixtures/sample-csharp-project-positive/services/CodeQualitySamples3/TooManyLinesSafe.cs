namespace Positive.Boundary.CodeQuality;

/// <summary>A method short enough to stay well under the line threshold.</summary>
public sealed class TooManyLinesSafe
{
    /// <summary>Sums the three supplied values.</summary>
    internal int Sum(int a, int b, int c)
    {
        // SAFE: code-quality/deterministic/too-many-lines
        var total = a + b;
        total += c;
        return total;
    }
}
