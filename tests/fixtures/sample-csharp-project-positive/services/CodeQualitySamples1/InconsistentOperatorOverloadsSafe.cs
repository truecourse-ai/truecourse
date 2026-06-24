using System;

namespace Positive.Boundary.CodeQuality;

/// <summary>
/// A value type that overloads both complements of the equality pair
/// (<c>==</c> and <c>!=</c>) with matching equality members, so the operator set
/// is consistent and the inconsistent-operator-overloads rule must not fire.
/// </summary>
public readonly struct InconsistentOperatorOverloadsSafe : IEquatable<InconsistentOperatorOverloadsSafe>
{
    /// <summary>Creates a tick value.</summary>
    public InconsistentOperatorOverloadsSafe(int ticks) => Ticks = ticks;

    /// <summary>The wrapped tick count.</summary>
    public int Ticks { get; }

    /// <summary>Value-equality against another instance.</summary>
    public bool Equals(InconsistentOperatorOverloadsSafe other) => Ticks == other.Ticks;

    /// <inheritdoc/>
    public override bool Equals(object? obj) => obj is InconsistentOperatorOverloadsSafe other && Equals(other);

    /// <inheritdoc/>
    public override int GetHashCode() => Ticks.GetHashCode();

    // SAFE: code-quality/deterministic/inconsistent-operator-overloads
    /// <summary>Equality operator paired with its complement below.</summary>
    public static bool operator ==(InconsistentOperatorOverloadsSafe left, InconsistentOperatorOverloadsSafe right) => left.Equals(right);

    /// <summary>Inequality operator completing the pair.</summary>
    public static bool operator !=(InconsistentOperatorOverloadsSafe left, InconsistentOperatorOverloadsSafe right) => !left.Equals(right);
}
