using System;

namespace Positive.Boundary.CodeQuality;

/// <summary>
/// `new TimeSpan(...)` with arguments runs a real constructor, so it is not
/// equivalent to `default(TimeSpan)` and the default-value-type-constructor
/// rule must not fire.
/// </summary>
public class DefaultValueTypeConstructorSafe
{
    /// <summary>Returns the lockout window after too many failures.</summary>
    public TimeSpan Lockout(int minutes)
    {
        // SAFE: code-quality/deterministic/default-value-type-constructor
        return new TimeSpan(0, minutes, 0);
    }
}
