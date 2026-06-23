namespace Positive.Boundary.Bugs;

/// <summary>A sealed value object implementing IEquatable over itself — the safe form.</summary>
// SAFE: bugs/deterministic/iequatable-class-not-sealed
public sealed class IequatableClassNotSealedSafe : System.IEquatable<IequatableClassNotSealedSafe>
{
    private readonly int _amount;

    /// <summary>Creates the value with the given amount.</summary>
    public IequatableClassNotSealedSafe(int amount)
    {
        _amount = amount;
    }

    /// <summary>Compares by amount.</summary>
    public bool Equals(IequatableClassNotSealedSafe? other)
    {
        return other is not null && other._amount == _amount;
    }

    /// <summary>Reference-equality-aware override delegating to the typed comparison.</summary>
    public override bool Equals(object? obj)
    {
        return Equals(obj as IequatableClassNotSealedSafe);
    }

    /// <summary>Hashes by amount.</summary>
    public override int GetHashCode()
    {
        return _amount;
    }
}
