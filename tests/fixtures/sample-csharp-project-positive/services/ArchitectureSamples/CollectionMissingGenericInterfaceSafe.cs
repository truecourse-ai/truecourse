using System.Collections;
using System.Collections.Generic;

namespace Positive.Boundary.Architecture;

/// <summary>A strongly typed set of granted permissions.</summary>
// SAFE: architecture/deterministic/collection-missing-generic-interface
public sealed class CollectionMissingGenericInterfaceSafe : IEnumerable<string>, IEnumerable
{
    private readonly List<string> _permissions = new();

    /// <summary>Grant a permission.</summary>
    public void Add(string permission) => _permissions.Add(permission);

    /// <summary>Iterate the granted permissions.</summary>
    public IEnumerator<string> GetEnumerator() => _permissions.GetEnumerator();

    IEnumerator IEnumerable.GetEnumerator() => GetEnumerator();
}
