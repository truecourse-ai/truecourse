using System;

namespace Positive.Boundary.CodeQuality;

/// <summary>
/// An argument-exception whose parameter-name argument already uses
/// <c>nameof(displayName)</c> rather than a string literal, the form the rule
/// recommends, so the rename-safety check must not fire.
/// </summary>
public class UseNameofForMemberSafe
{
    /// <summary>Validates a display name, throwing with a rename-safe parameter name.</summary>
    public void Validate(string displayName)
    {
        if (displayName == null)
        {
            // SAFE: code-quality/deterministic/use-nameof-for-member
            throw new ArgumentException("Display name is required.", nameof(displayName));
        }
    }
}
