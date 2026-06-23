using System;

namespace UserServiceApp.Violations.CodeQuality;

/// <summary>
/// A money value object used for account balances. It grew typed equality and a
/// handful of operators ad hoc, so the equality contract and operator set are now
/// inconsistent.
/// </summary>
// VIOLATION: code-quality/deterministic/value-type-equals-without-operator
// VIOLATION: code-quality/deterministic/equatable-without-iequatable
// VIOLATION: code-quality/deterministic/inconsistent-operator-overloads
// VIOLATION: performance/deterministic/value-type-without-iequatable
internal readonly struct MoneyAmount
{
    public MoneyAmount(decimal value, string currency)
    {
        Value = value;
        Currency = currency;
    }

    public decimal Value { get; }

    public string Currency { get; }

    /// <summary>Value-equality against another amount.</summary>
    public bool Equals(MoneyAmount other)
    {
        return Value == other.Value && string.Equals(Currency, other.Currency, StringComparison.Ordinal);
    }

    public override bool Equals(object? obj) => obj is MoneyAmount other && Equals(other);

    public override int GetHashCode() => HashCode.Combine(Value, Currency);

    // VIOLATION: code-quality/deterministic/operator-without-named-alternative
    public static MoneyAmount operator +(MoneyAmount left, MoneyAmount right)
    {
        return new MoneyAmount(left.Value + right.Value, left.Currency);
    }

    // VIOLATION: code-quality/deterministic/asymmetric-equality-operators
    public static bool operator <(MoneyAmount left, MoneyAmount right) => left.Value < right.Value;
}
