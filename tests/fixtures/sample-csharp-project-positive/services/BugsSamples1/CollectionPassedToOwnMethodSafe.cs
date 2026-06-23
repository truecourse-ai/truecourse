using System.Collections.Generic;

namespace Positive.Boundary.Bugs;

/// <summary>Merges two distinct integer collections.</summary>
public sealed class CollectionPassedToOwnMethodSafe
{
    private readonly List<int> _target = new();

    /// <summary>Appends every element of <paramref name="source"/> to the target.</summary>
    internal List<int> Merge(List<int> source)
    {
        // SAFE: bugs/deterministic/collection-passed-to-own-method
        _target.AddRange(source);
        return _target;
    }
}
