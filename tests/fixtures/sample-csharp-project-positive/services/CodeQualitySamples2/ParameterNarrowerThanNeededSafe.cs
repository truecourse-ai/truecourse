using System.Collections.Generic;

namespace Positive.Boundary.CodeQuality;

/// <summary>
/// A method taking a concrete <c>List&lt;int&gt;</c> that does more than iterate it:
/// it mutates the list with <c>Add</c>. Because not every reference is a
/// <c>foreach</c> collection, widening to <c>IEnumerable&lt;int&gt;</c> would break the
/// body, so the narrowing check must not fire.
/// </summary>
public sealed class ParameterNarrowerThanNeededSafe
{
    /// <summary>Appends a sentinel and returns the running total of the batch.</summary>
    // SAFE: code-quality/deterministic/parameter-narrower-than-needed
    internal long SumAmounts(List<int> amounts)
    {
        amounts.Add(0);
        long total = 0;
        foreach (var amount in amounts)
        {
            total += amount;
        }
        return total;
    }
}
