using System;

namespace Positive.Boundary.CodeQuality;

/// <summary>
/// A concrete attribute type that is already <c>sealed</c> (and carries the
/// conventional <c>Attribute</c> suffix). The non-abstract-attribute-not-sealed
/// rule only flags an unsealed, non-abstract <c>System.Attribute</c> subclass,
/// so a sealed one must not fire.
/// </summary>
// SAFE: code-quality/deterministic/non-abstract-attribute-not-sealed
[AttributeUsage(AttributeTargets.Method)]
public sealed class NonAbstractAttributeNotSealedSafeAttribute : Attribute
{
    /// <summary>The retry budget this attribute advertises.</summary>
    public int MaxRetries { get; }

    /// <summary>Creates the attribute with the given retry budget.</summary>
    public NonAbstractAttributeNotSealedSafeAttribute(int maxRetries) => MaxRetries = maxRetries;
}
