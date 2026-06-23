using System;

namespace Positive.Boundary.Bugs;

/// <summary>A quantity ordered by magnitude, with equality and operators aligned.</summary>
// SAFE: bugs/deterministic/icomparable-without-equality-operators
public readonly struct IComparableWithoutEqualityOperatorsSafe
    : IComparable<IComparableWithoutEqualityOperatorsSafe>, IEquatable<IComparableWithoutEqualityOperatorsSafe>
{
    private readonly int _units;

    /// <summary>Creates a quantity from a unit count.</summary>
    public IComparableWithoutEqualityOperatorsSafe(int units)
    {
        _units = units;
    }

    /// <summary>Orders quantities by their unit count.</summary>
    public int CompareTo(IComparableWithoutEqualityOperatorsSafe other) =>
        _units.CompareTo(other._units);

    /// <summary>Compares quantities by unit count.</summary>
    public bool Equals(IComparableWithoutEqualityOperatorsSafe other) =>
        other._units == _units;

    /// <summary>Compares quantities by unit count.</summary>
    public override bool Equals(object? obj) =>
        obj is IComparableWithoutEqualityOperatorsSafe other && Equals(other);

    /// <summary>Hashes by unit count.</summary>
    public override int GetHashCode() => _units;

    /// <summary>Equality operator.</summary>
    public static bool operator ==(IComparableWithoutEqualityOperatorsSafe left, IComparableWithoutEqualityOperatorsSafe right) =>
        left.Equals(right);

    /// <summary>Inequality operator.</summary>
    public static bool operator !=(IComparableWithoutEqualityOperatorsSafe left, IComparableWithoutEqualityOperatorsSafe right) =>
        !(left == right);

    /// <summary>Less-than operator.</summary>
    public static bool operator <(IComparableWithoutEqualityOperatorsSafe left, IComparableWithoutEqualityOperatorsSafe right) =>
        left.CompareTo(right) < 0;

    /// <summary>Greater-than operator.</summary>
    public static bool operator >(IComparableWithoutEqualityOperatorsSafe left, IComparableWithoutEqualityOperatorsSafe right) =>
        right < left;

    /// <summary>Less-than-or-equal operator.</summary>
    public static bool operator <=(IComparableWithoutEqualityOperatorsSafe left, IComparableWithoutEqualityOperatorsSafe right) =>
        !(right < left);

    /// <summary>Greater-than-or-equal operator.</summary>
    public static bool operator >=(IComparableWithoutEqualityOperatorsSafe left, IComparableWithoutEqualityOperatorsSafe right) =>
        !(left < right);
}
