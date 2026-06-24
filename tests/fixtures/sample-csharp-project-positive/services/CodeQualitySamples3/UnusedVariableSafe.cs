namespace Positive.Boundary.CodeQuality;

/// <summary>Declares a local and reads it in a derived computation.</summary>
public sealed class UnusedVariableSafe
{
    /// <summary>Combines the input with an intermediate local.</summary>
    internal int Combine(int value)
    {
        // SAFE: code-quality/deterministic/unused-variable
        var doubled = value + value;
        return doubled + value;
    }
}
