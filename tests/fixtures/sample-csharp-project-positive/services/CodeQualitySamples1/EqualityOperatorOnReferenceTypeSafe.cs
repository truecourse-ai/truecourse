namespace Positive.Boundary.CodeQuality;

/// <summary>
/// A 2D point with value semantics expressed correctly as a <c>struct</c>.
/// Overloading <c>==</c> on a value type is idiomatic, so the rule (which only
/// flags <c>==</c> overloads declared on a reference type / class) must not fire.
/// </summary>
public readonly struct EqualityOperatorOnReferenceTypeSafe : System.IEquatable<EqualityOperatorOnReferenceTypeSafe>
{
    /// <summary>The horizontal coordinate.</summary>
    public int X { get; }

    /// <summary>The vertical coordinate.</summary>
    public int Y { get; }

    /// <summary>Creates a point at the given coordinates.</summary>
    public EqualityOperatorOnReferenceTypeSafe(int x, int y)
    {
        X = x;
        Y = y;
    }

    /// <summary>Compares two points for value equality.</summary>
    // SAFE: code-quality/deterministic/equality-operator-on-reference-type
    public static bool operator ==(EqualityOperatorOnReferenceTypeSafe left, EqualityOperatorOnReferenceTypeSafe right) => left.X == right.X && left.Y == right.Y;

    /// <summary>Compares two points for value inequality.</summary>
    public static bool operator !=(EqualityOperatorOnReferenceTypeSafe left, EqualityOperatorOnReferenceTypeSafe right) => !(left == right);

    /// <summary>Compares this point with another for value equality.</summary>
    public bool Equals(EqualityOperatorOnReferenceTypeSafe other) => X == other.X && Y == other.Y;

    /// <summary>Compares this point with another object.</summary>
    public override bool Equals(object? obj) => obj is EqualityOperatorOnReferenceTypeSafe other && Equals(other);

    /// <summary>Returns a hash code for this point.</summary>
    public override int GetHashCode() => System.HashCode.Combine(X, Y);
}
