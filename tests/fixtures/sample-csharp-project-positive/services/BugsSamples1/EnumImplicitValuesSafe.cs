namespace Positive.Boundary.Bugs;

/// <summary>A fully-implicit enum — every member bare — which is the ordinary, safe form.</summary>
public enum EnumImplicitValuesSafe
{
    // SAFE: bugs/deterministic/enum-implicit-values
    None,

    /// <summary>Work has started.</summary>
    Active,

    /// <summary>Work has finished.</summary>
    Complete,
}
