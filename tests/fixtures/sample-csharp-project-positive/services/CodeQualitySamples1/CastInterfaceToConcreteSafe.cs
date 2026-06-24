using System.Collections.Generic;

namespace Positive.Boundary.CodeQuality;

/// <summary>Narrows one interface to another interface, never to a concrete type.</summary>
public sealed class CastInterfaceToConcreteSafe
{
    /// <summary>Counts items, narrowing the sequence to a richer interface only.</summary>
    internal int CountVia(IEnumerable<string> items)
    {
        // SAFE: code-quality/deterministic/cast-interface-to-concrete
        var collection = items as IReadOnlyCollection<string>;
        return collection?.Count ?? 0;
    }
}
