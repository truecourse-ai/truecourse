namespace Positive.Boundary.Performance;

/// <summary>Validates user handles using length-based emptiness checks.</summary>
public sealed class EmptyStringComparedWithEqualsSafe
{
    /// <summary>True when the handle has no characters.</summary>
    internal bool IsBlank(string handle)
    {
        // SAFE: performance/deterministic/empty-string-compared-with-equals
        return string.IsNullOrEmpty(handle);
    }
}
