using System.Collections.Generic;

namespace ApiGateway.Violations.CodeQuality;

/// <summary>
/// Sums a batch of line amounts, scaling each by a fixed factor. The batch parameter is
/// typed as a concrete List even though the method only iterates it, needlessly forcing
/// every caller to materialize a List.
/// </summary>
internal sealed class TotalsCalculator
{
    private readonly int _scale;

    public TotalsCalculator(int scale)
    {
        _scale = scale;
    }

    /// <summary>Returns the scaled sum of every amount in the batch.</summary>
    // VIOLATION: code-quality/deterministic/parameter-narrower-than-needed
    public long SumAmounts(List<int> amounts)
    {
        long total = 0;
        foreach (var amount in amounts)
        {
            total += amount * _scale;
        }
        return total;
    }
}
