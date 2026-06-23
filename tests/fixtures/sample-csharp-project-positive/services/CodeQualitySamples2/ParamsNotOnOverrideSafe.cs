using System;

namespace Positive.Boundary.CodeQuality;

/// <summary>Base formatter whose variadic join is overridable.</summary>
public abstract class ParamsNotOnOverrideSafeBase
{
    /// <summary>Joins the parts with the given separator.</summary>
    public abstract string Join(string separator, params string[] parts);
}

/// <summary>
/// An override that keeps the <c>params</c> modifier on its final array
/// parameter, so callers reaching the method through this type retain the
/// variadic call form and the dropped-params check must not fire.
/// </summary>
public sealed class ParamsNotOnOverrideSafe : ParamsNotOnOverrideSafeBase
{
    /// <summary>Joins the parts with the separator and a trailing marker.</summary>
    // SAFE: code-quality/deterministic/params-not-on-override
    public override string Join(string separator, params string[] parts)
    {
        return string.Join(separator, parts) + "!";
    }
}
