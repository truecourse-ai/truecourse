using System;

namespace Positive.Boundary.CodeQuality;

/// <summary>Marks a class as gated behind a named feature flag.</summary>
// SAFE: code-quality/deterministic/unsealed-attribute
[AttributeUsage(AttributeTargets.Class, AllowMultiple = false)]
internal sealed class FeatureGateAttribute : Attribute
{
    /// <summary>The name of the feature flag.</summary>
    public string Flag { get; }

    /// <summary>Creates the attribute for the given flag name.</summary>
    public FeatureGateAttribute(string flag)
    {
        Flag = flag;
    }
}

/// <summary>Hosts a sealed custom attribute so the unsealed rule must not fire.</summary>
public sealed class UnsealedAttributeSafe
{
    /// <summary>Returns the flag name carried by the given attribute.</summary>
    internal string FlagName(FeatureGateAttribute gate)
    {
        return gate.Flag;
    }
}
