namespace Positive.Boundary.CodeQuality;

/// <summary>
/// A generic type carrying exactly two type parameters sits at the CA1005
/// boundary (the rule flags three or more), so it must not fire.
/// </summary>
// SAFE: code-quality/deterministic/too-many-type-parameters
public class TooManyTypeParametersSafe<TKey, TValue>
{
    internal TKey Key { get; }

    internal TValue Value { get; }

    /// <summary>Creates a pair from the given key and value.</summary>
    public TooManyTypeParametersSafe(TKey key, TValue value)
    {
        Key = key;
        Value = value;
    }
}
