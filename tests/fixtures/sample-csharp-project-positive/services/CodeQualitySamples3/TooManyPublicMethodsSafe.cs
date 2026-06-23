namespace Positive.Boundary.CodeQuality;

/// <summary>A focused class with only a handful of public methods.</summary>
public sealed class TooManyPublicMethodsSafe
{
    // SAFE: code-quality/deterministic/too-many-public-methods
    /// <summary>Returns the incremented value.</summary>
    public int Increment(int value) => value + 1;

    /// <summary>Returns the decremented value.</summary>
    public int Decrement(int value) => value - 1;
}
