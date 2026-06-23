using System;

namespace Positive.Boundary.CodeQuality;

/// <summary>
/// string.IndexOf whose result is compared against a real position, not against 0 or
/// -1, so it expresses "appears after this point" rather than mere presence. Contains
/// could not replace it, so the indexof-for-presence-check rule must not fire.
/// </summary>
public class IndexOfForPresenceCheckSafe
{
    /// <summary>True when the separator first appears past the leading prefix region.</summary>
    public bool SeparatorAfterPrefix(string value, char separator, int prefixLength)
    {
        // SAFE: code-quality/deterministic/indexof-for-presence-check
        return value.IndexOf(separator) > prefixLength;
    }
}
