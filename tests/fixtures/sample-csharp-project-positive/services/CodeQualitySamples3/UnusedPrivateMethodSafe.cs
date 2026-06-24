using System.Collections.Generic;
using System.Linq;

namespace Positive.Boundary.CodeQuality;

/// <summary>Uses a private method only as a method-group argument to LINQ.</summary>
public sealed class UnusedPrivateMethodSafe
{
    /// <summary>Returns the positive values from the source.</summary>
    public IEnumerable<int> Positive(IEnumerable<int> source)
    {
        return source.Where(IsPositive);
    }

    // SAFE: code-quality/deterministic/unused-private-method
    private static bool IsPositive(int value)
    {
        return value > 0;
    }
}
