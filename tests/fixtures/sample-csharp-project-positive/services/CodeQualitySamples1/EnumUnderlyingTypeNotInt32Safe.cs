namespace Positive.Boundary.CodeQuality;

/// <summary>
/// Holds an enum that explicitly declares its underlying type as <c>int</c>
/// (Int32). The rule flags non-Int32 storage such as <c>long</c> or
/// <c>byte</c>; an explicit <c>int</c> base matches the convention and must not
/// fire.
/// </summary>
public static class EnumUnderlyingTypeNotInt32Safe
{
    /// <summary>Backoff strategies stored as the conventional Int32.</summary>
    // SAFE: code-quality/deterministic/enum-underlying-type-not-int32
    public enum BackoffKind : int
    {
        None = 0,
        Linear = 1,
        Exponential = 2,
    }
}
