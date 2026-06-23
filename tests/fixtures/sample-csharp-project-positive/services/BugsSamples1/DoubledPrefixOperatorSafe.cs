namespace Positive.Boundary.Bugs;

/// <summary>Normalizes a bitmask using a single bitwise complement.</summary>
public sealed class DoubledPrefixOperatorSafe
{
    /// <summary>Returns the bitwise complement of the mask (applied exactly once).</summary>
    internal int Normalize(int mask)
    {
        // SAFE: bugs/deterministic/doubled-prefix-operator
        return ~mask;
    }
}
