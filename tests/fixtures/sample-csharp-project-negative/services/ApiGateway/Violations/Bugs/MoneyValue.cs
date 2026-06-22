using System;

namespace ApiGateway.Violations.Bugs;

// A monetary value object. It implements IEquatable<Money> but is left unsealed,
// so a derived type could break the equality contract (Equals not symmetric).
// VIOLATION: bugs/deterministic/iequatable-class-not-sealed
internal class Money : IEquatable<Money>
{
    // VIOLATION: code-quality/deterministic/mutable-private-member
    private int _cents;

    public Money(int cents)
    {
        _cents = cents;
    }

    /// <summary>Two amounts are equal when their cent counts match.</summary>
    public bool Equals(Money other) => other is not null && other._cents == _cents;

    public override bool Equals(object obj) => Equals(obj as Money);

    // GetHashCode reads a mutable (non-readonly) field, so the hash changes if the
    // instance is mutated while stored in a dictionary.
    // VIOLATION: bugs/deterministic/gethashcode-uses-mutable-field
    public override int GetHashCode() => _cents;
}

// A quantity ordered by magnitude. It implements IComparable<T> but defines no
// equality members or comparison operators, so ordering and equality disagree.
// VIOLATION: bugs/deterministic/icomparable-without-equality-operators
internal sealed class Quantity : IComparable<Quantity>
{
    private readonly int _units;

    public Quantity(int units)
    {
        _units = units;
    }

    /// <summary>Orders quantities by their unit count.</summary>
    public int CompareTo(Quantity other) => _units.CompareTo(other._units);
}
