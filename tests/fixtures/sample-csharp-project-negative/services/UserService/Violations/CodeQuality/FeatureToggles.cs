using System;

namespace UserServiceApp.Violations.CodeQuality;

/// <summary>
/// Reads feature toggles for the user service. The static defaults are initialized
/// in a static constructor, one instance field is never reassigned, and the public
/// surface still exposes optional parameters and an undocumented obsolete member.
/// </summary>
public sealed class FeatureToggles
{
    // VIOLATION: code-quality/deterministic/static-field-initialize-inline
    private static readonly string ConfigRoot;

    // VIOLATION: code-quality/deterministic/mutable-private-member
    // VIOLATION: code-quality/deterministic/field-can-be-readonly
    private string _environment;

    static FeatureToggles()
    {
        ConfigRoot = "/etc/userservice";
    }

    public FeatureToggles(string environment)
    {
        _environment = environment;
    }

    // VIOLATION: code-quality/deterministic/optional-parameter-hazard
    public bool IsEnabled(string flag, bool fallback = false)
    {
        return flag.StartsWith(_environment, StringComparison.Ordinal) || fallback;
    }

    // VIOLATION: code-quality/deterministic/obsolete-without-message
    // VIOLATION: code-quality/deterministic/obsolete-without-explanation
    [Obsolete]
    public string ConfigPath() => ConfigRoot;
}
