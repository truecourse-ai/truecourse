namespace Positive.Boundary.CodeQuality;

/// <summary>
/// Holds an enum where every member carries an explicit initializer and one of
/// them is valued 0. The rule fires only when every member is explicitly
/// non-zero, so a defined zero member names the default value and must not fire.
/// </summary>
public static class EnumMissingZeroValueSafe
{
    /// <summary>Dispatch stages, with an explicit zero default.</summary>
    public enum DispatchStage
    {
        // SAFE: code-quality/deterministic/enum-missing-zero-value
        Idle = 0,
        Created = 1,
        Active = 2,
    }
}
