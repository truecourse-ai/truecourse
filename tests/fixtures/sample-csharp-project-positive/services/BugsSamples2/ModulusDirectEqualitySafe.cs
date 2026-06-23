namespace Positive.Boundary.Bugs;

/// <summary>Tests even-ness by comparing the modulus against zero.</summary>
internal sealed class ModulusDirectEqualitySafe
{
    /// <summary>Returns true when the index is even, which is correct for negative inputs too.</summary>
    internal bool IsEven(int index)
    {
        // SAFE: bugs/deterministic/modulus-direct-equality
        return index % 2 == 0;
    }
}
