using System.Collections.Generic;
using System.Linq;

namespace Positive.Boundary.Bugs;

/// <summary>Combines line-item totals into a single running sum.</summary>
public sealed class ReduceMissingInitialSafe
{
    /// <summary>Sums the amounts, seeding the fold so an empty sequence is safe.</summary>
    internal decimal Total(IEnumerable<decimal> amounts)
    {
        // SAFE: bugs/deterministic/reduce-missing-initial
        return amounts.Aggregate(0m, (running, next) => running + next);
    }
}
