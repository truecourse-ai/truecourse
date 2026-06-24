namespace Positive.Boundary.Bugs;

/// <summary>Holds shared configuration as immutable visible statics.</summary>
public sealed class NonConstantStaticFieldVisibleSafe
{
    // SAFE: bugs/deterministic/non-constant-static-field-visible
    public static readonly string DefaultRegion = "global".ToUpperInvariant();

    /// <summary>Returns the configured default region.</summary>
    internal string Region()
    {
        return DefaultRegion;
    }
}
