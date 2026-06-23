namespace Positive.Boundary.CodeQuality;

/// <summary>
/// A private method that returns a value which the sole caller actually consumes.
/// return-value-never-used only fires when every call site discards the result.
/// </summary>
public class ReturnValueNeverUsedSafe
{
    private int _calls;

    /// <summary>Returns the normalized length of the supplied label.</summary>
    public int Measure(string label)
    {
        return Normalize(label);
    }

    // SAFE: code-quality/deterministic/return-value-never-used
    private int Normalize(string label)
    {
        _calls += 1;
        return label.Trim().Length + _calls;
    }
}
