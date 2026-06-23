namespace Positive.Boundary.Performance;

/// <summary>Tests for a separator using the cheaper char overload.</summary>
public sealed class StringContainsCharSafe
{
    /// <summary>Returns true when the handle contains a dot separator.</summary>
    internal bool HasSeparator(string handle)
    {
        // SAFE: performance/deterministic/string-contains-char
        return handle.Contains('.');
    }
}
