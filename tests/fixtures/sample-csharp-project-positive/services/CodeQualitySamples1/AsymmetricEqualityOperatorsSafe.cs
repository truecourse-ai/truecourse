namespace Positive.Boundary.CodeQuality;

/// <summary>A price band that exposes a complete relational operator surface.</summary>
public sealed class AsymmetricEqualityOperatorsSafe
{
    /// <summary>The band's numeric value.</summary>
    public decimal Value { get; }

    /// <summary>Creates a band with the given value.</summary>
    public AsymmetricEqualityOperatorsSafe(decimal value)
    {
        Value = value;
    }

    /// <summary>Returns true when the left band orders before the right.</summary>
    // SAFE: code-quality/deterministic/asymmetric-equality-operators
    public static bool operator <(AsymmetricEqualityOperatorsSafe a, AsymmetricEqualityOperatorsSafe b) => a.Value < b.Value;

    /// <summary>Returns true when the left band orders at or before the right.</summary>
    public static bool operator <=(AsymmetricEqualityOperatorsSafe a, AsymmetricEqualityOperatorsSafe b) => a.Value <= b.Value;

    /// <summary>Returns true when the left band orders after the right.</summary>
    public static bool operator >(AsymmetricEqualityOperatorsSafe a, AsymmetricEqualityOperatorsSafe b) => a.Value > b.Value;

    /// <summary>Returns true when the left band orders at or after the right.</summary>
    public static bool operator >=(AsymmetricEqualityOperatorsSafe a, AsymmetricEqualityOperatorsSafe b) => a.Value >= b.Value;
}
