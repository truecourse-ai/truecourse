namespace Positive.Boundary.CodeQuality;

/// <summary>
/// A counting loop whose termination condition uses comparison (<c>&lt;</c>),
/// not assignment. The rule fires only when a for-loop condition is an
/// assignment (<c>=</c>) misused for comparison, so this idiomatic loop is safe.
/// </summary>
public sealed class EqualsInForTerminationSafe
{
    /// <summary>Computes an index-weighted sum of the given span.</summary>
    internal int SumElements(System.ReadOnlySpan<int> values)
    {
        var total = 0;
        // SAFE: code-quality/deterministic/equals-in-for-termination
        for (var i = 0; i < values.Length; i++)
        {
            total += values[i] * i;
        }

        return total;
    }
}
