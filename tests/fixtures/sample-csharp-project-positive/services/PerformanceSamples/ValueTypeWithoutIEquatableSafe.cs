using System;

namespace Positive.Boundary.Performance;

/// <summary>
/// A strongly-typed identifier struct that overrides object.Equals for value semantics
/// and correctly declares IEquatable&lt;ValueTypeWithoutIEquatableSafe&gt;, so equality
/// avoids boxing and the reflective ValueType.Equals fallback.
/// </summary>
// SAFE: performance/deterministic/value-type-without-iequatable
public readonly struct ValueTypeWithoutIEquatableSafe : IEquatable<ValueTypeWithoutIEquatableSafe>
{
    private readonly long _value;

    /// <summary>Wraps the raw identifier value.</summary>
    public ValueTypeWithoutIEquatableSafe(long value) => _value = value;

    /// <summary>Compares this identifier with another of the same type.</summary>
    public bool Equals(ValueTypeWithoutIEquatableSafe other) => other._value == _value;

    /// <summary>Compares this identifier with an arbitrary object.</summary>
    public override bool Equals(object? obj) => obj is ValueTypeWithoutIEquatableSafe other && Equals(other);

    /// <summary>Returns the hash of the wrapped value.</summary>
    public override int GetHashCode() => _value.GetHashCode();

    /// <summary>Returns whether two identifiers are equal.</summary>
    public static bool operator ==(ValueTypeWithoutIEquatableSafe left, ValueTypeWithoutIEquatableSafe right) => left.Equals(right);

    /// <summary>Returns whether two identifiers differ.</summary>
    public static bool operator !=(ValueTypeWithoutIEquatableSafe left, ValueTypeWithoutIEquatableSafe right) => !left.Equals(right);
}
