namespace Positive.Boundary.CodeQuality;

/// <summary>A method whose nesting stays within the readable threshold.</summary>
public sealed class TooManyNestedBlocksSafe
{
    /// <summary>Accumulates a bounded count across the positive values.</summary>
    internal int Accumulate(int[] values)
    {
        // SAFE: code-quality/deterministic/too-many-nested-blocks
        var count = 0;
        foreach (var value in values)
        {
            if (value > 0)
            {
                for (var i = 0; i < value; i++)
                {
                    count += 1;
                }
            }
        }
        return count;
    }
}
