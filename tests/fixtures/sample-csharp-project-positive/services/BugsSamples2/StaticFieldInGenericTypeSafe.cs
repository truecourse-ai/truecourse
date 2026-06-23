using System.Collections.Generic;

namespace Positive.Boundary.Bugs;

/// <summary>A generic cache whose only static member is a compile-time constant.</summary>
public sealed class StaticFieldInGenericTypeSafe<TValue>
{
    // SAFE: bugs/deterministic/static-field-in-generic-type
    private const int DefaultCapacity = 16;

    private readonly Dictionary<string, TValue> _entries = new(DefaultCapacity);

    /// <summary>Stores a value under the given key for this instance.</summary>
    internal void Store(string key, TValue value) => _entries[key] = value;
}
