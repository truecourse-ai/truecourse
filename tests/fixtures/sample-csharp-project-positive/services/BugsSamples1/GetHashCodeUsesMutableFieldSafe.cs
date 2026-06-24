namespace Positive.Boundary.Bugs;

/// <summary>A value type whose hash derives only from an immutable field.</summary>
public sealed class GetHashCodeUsesMutableFieldSafe
{
    private readonly int _cents;

    /// <summary>Creates the value from a cent amount.</summary>
    public GetHashCodeUsesMutableFieldSafe(int cents)
    {
        _cents = cents;
    }

    // SAFE: bugs/deterministic/gethashcode-uses-mutable-field
    public override int GetHashCode() => _cents;

    /// <summary>Compares by cent amount.</summary>
    public override bool Equals(object? obj) =>
        obj is GetHashCodeUsesMutableFieldSafe other && other._cents == _cents;
}
