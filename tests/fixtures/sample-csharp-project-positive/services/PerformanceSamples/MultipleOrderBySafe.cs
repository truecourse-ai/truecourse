using System.Collections.Generic;
using System.Linq;

namespace Positive.Boundary.Performance;

/// <summary>Ranks records by multiple keys without discarding an earlier sort.</summary>
public sealed class MultipleOrderBySafe
{
    /// <summary>Sorts by activity, then by login count via ThenByDescending so both keys apply.</summary>
    internal IEnumerable<int> Ranked(IEnumerable<int> values)
    {
        // SAFE: performance/deterministic/multiple-orderby
        return values.OrderBy(v => v % 2).ThenByDescending(v => v);
    }
}
