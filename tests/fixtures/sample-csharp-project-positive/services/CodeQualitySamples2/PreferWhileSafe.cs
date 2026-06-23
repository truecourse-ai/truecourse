namespace Positive.Boundary.CodeQuality;

/// <summary>Counts down using a for loop with a real initializer and update.</summary>
public sealed class PreferWhileSafe
{
    /// <summary>Returns the sum of the integers from the start value down to one.</summary>
    internal int SumDown(int start)
    {
        var total = 0;
        // SAFE: code-quality/deterministic/prefer-while
        for (var i = start; i > 0; i--)
        {
            total += i;
        }
        return total;
    }
}
