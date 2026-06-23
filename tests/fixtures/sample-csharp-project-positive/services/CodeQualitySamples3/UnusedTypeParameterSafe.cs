using System.Collections.Generic;

namespace Positive.Boundary.CodeQuality;

/// <summary>Declares a generic method whose type parameter appears in its signature.</summary>
public sealed class UnusedTypeParameterSafe
{
    /// <summary>Wraps a single item in a list; the type parameter drives the return type.</summary>
    // SAFE: code-quality/deterministic/unused-type-parameter
    public IReadOnlyList<TItem> Wrap<TItem>(TItem item)
    {
        return new List<TItem> { item };
    }
}
