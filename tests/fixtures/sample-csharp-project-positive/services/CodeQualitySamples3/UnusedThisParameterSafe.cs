namespace Positive.Boundary.CodeQuality;

/// <summary>Has a private method that depends on instance state, so it stays instance-bound.</summary>
public sealed class UnusedThisParameterSafe
{
    private readonly int _offset;

    /// <summary>Captures the offset added to every shifted value.</summary>
    public UnusedThisParameterSafe(int offset)
    {
        _offset = offset;
    }

    /// <summary>Shifts the value by the configured instance offset.</summary>
    public int Shift(int value)
    {
        return Combine(value);
    }

    // SAFE: code-quality/deterministic/unused-this-parameter
    private int Combine(int value)
    {
        return value + _offset;
    }
}
