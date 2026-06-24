using System;

namespace Positive.Boundary.CodeQuality;

/// <summary>Marks a class as gated behind a named feature flag.</summary>
[AttributeUsage(AttributeTargets.Class, AllowMultiple = false)]
// SAFE: code-quality/deterministic/attribute-missing-usage
internal sealed class FeatureFlagAttribute : Attribute
{
    /// <summary>The name of the feature flag.</summary>
    public string Name { get; }

    /// <summary>Creates the attribute for the given flag name.</summary>
    public FeatureFlagAttribute(string name)
    {
        Name = name;
    }
}

/// <summary>Hosts a custom attribute that declares its valid usage.</summary>
public sealed class AttributeMissingUsageSafe
{
    /// <summary>Returns the flag name carried by the given attribute.</summary>
    internal string FlagName(FeatureFlagAttribute flag)
    {
        return flag.Name;
    }
}
