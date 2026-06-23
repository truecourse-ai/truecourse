using System.Collections.Generic;

namespace Positive.Boundary.CodeQuality;

/// <summary>
/// A foreach that accumulates a running total rather than short-circuiting on a
/// predicate. It is not the `Any`/`All` early-return shape, so the
/// reimplemented-builtin rule must not fire.
/// </summary>
public class ReimplementedBuiltinSafe
{
    /// <summary>Sums the quantities of every item.</summary>
    public int TotalQuantity(IEnumerable<int> quantities)
    {
        var total = 0;
        // SAFE: code-quality/deterministic/reimplemented-builtin
        foreach (var quantity in quantities)
        {
            total += quantity;
        }
        return total;
    }
}
