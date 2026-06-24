namespace Positive.Boundary.Bugs;

/// <summary>Carries a deliberate symbolic alias, not a duplicated integer literal.</summary>
public enum EnumDuplicateExplicitValueSafe
{
    /// <summary>The unset, default value.</summary>
    None = 0,

    /// <summary>First real mode.</summary>
    Primary = 1,

    /// <summary>Second real mode.</summary>
    Secondary = 2,

    // SAFE: bugs/deterministic/enum-duplicate-explicit-value
    Default = Primary,
}
