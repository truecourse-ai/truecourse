using System.Collections.Generic;

namespace Positive.Boundary.CodeQuality;

/// <summary>Generic helper whose method declares exactly the maximum two type parameters.</summary>
public sealed class TooManyGenericParametersSafe
{
    // SAFE: code-quality/deterministic/too-many-generic-parameters
    /// <summary>Wraps a key and value into a single-entry dictionary; two type parameters is the allowed maximum.</summary>
    internal Dictionary<TKey, TValue> Single<TKey, TValue>(TKey key, TValue value)
        where TKey : notnull
    {
        return new Dictionary<TKey, TValue> { [key] = value };
    }
}
