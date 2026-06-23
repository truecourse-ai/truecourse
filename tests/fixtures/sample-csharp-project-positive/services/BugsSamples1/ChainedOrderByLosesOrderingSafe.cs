using System.Collections.Generic;
using System.Linq;

namespace Positive.Boundary.Bugs;

/// <summary>Sorts records by a primary then a secondary key without losing order.</summary>
public sealed class ChainedOrderByLosesOrderingSafe
{
    /// <summary>Orders names by length, breaking ties alphabetically.</summary>
    internal IReadOnlyList<string> SortByLengthThenName(IEnumerable<string> names)
    {
        // SAFE: bugs/deterministic/chained-orderby-loses-ordering
        return names.OrderBy(n => n.Length).ThenBy(n => n).ToList();
    }
}
