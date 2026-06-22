using System;

namespace UserServiceApp.Violations.Performance;

/// <summary>
/// A strongly-typed wrapper around the raw user identifier. It gives itself
/// value-equality semantics by overriding object.Equals, but never declares
/// IEquatable&lt;UserId&gt;, so equality boxes and falls back to reflective
/// ValueType.Equals on every comparison.
/// </summary>
// VIOLATION: performance/deterministic/value-type-without-iequatable
// VIOLATION: code-quality/deterministic/value-type-equals-without-operator
internal struct UserId
{
    private readonly long _value;

    internal UserId(long value) => _value = value;

    public override bool Equals(object? obj) => obj is UserId other && other._value == _value;

    public override int GetHashCode() => _value.GetHashCode();

    public override string ToString() => _value.ToString();
}
