using System;

namespace Positive.Boundary.CodeQuality;

/// <summary>
/// A value type that overrides <c>Equals</c> AND defines <c>operator ==</c> (with the
/// matching <c>!=</c>), so the method and the operator agree. The rule only fires when
/// an <c>Equals</c> override is present without a <c>==</c> operator, so this consistent
/// pairing must not fire.
/// </summary>
public readonly struct ValueTypeEqualsWithoutOperatorSafe : IEquatable<ValueTypeEqualsWithoutOperatorSafe>
{
    /// <summary>Initializes the point with its x coordinate.</summary>
    public ValueTypeEqualsWithoutOperatorSafe(int x)
    {
        X = x;
    }

    /// <summary>The x coordinate.</summary>
    public int X { get; }

    /// <summary>Value-equality against another point.</summary>
    public bool Equals(ValueTypeEqualsWithoutOperatorSafe other) => X == other.X;

    /// <summary>Value-equality against an arbitrary object.</summary>
    public override bool Equals(object? obj) => obj is ValueTypeEqualsWithoutOperatorSafe other && Equals(other);

    /// <summary>Hash consistent with <see cref="Equals(object)"/>.</summary>
    public override int GetHashCode() => X.GetHashCode();

    // SAFE: code-quality/deterministic/value-type-equals-without-operator
    /// <summary>Equality operator kept consistent with <c>Equals</c>.</summary>
    public static bool operator ==(ValueTypeEqualsWithoutOperatorSafe left, ValueTypeEqualsWithoutOperatorSafe right) => left.Equals(right);

    /// <summary>Inequality operator, the negation of <c>==</c>.</summary>
    public static bool operator !=(ValueTypeEqualsWithoutOperatorSafe left, ValueTypeEqualsWithoutOperatorSafe right) => !left.Equals(right);
}
