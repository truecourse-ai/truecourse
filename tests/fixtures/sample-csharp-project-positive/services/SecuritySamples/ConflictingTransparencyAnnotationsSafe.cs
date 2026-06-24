using System.Security;

namespace Positive.Boundary.Security;

/// <summary>Carries a single transparency attribute, never two contradictory ones.</summary>
public sealed class ConflictingTransparencyAnnotationsSafe
{
    private int _invocations;

    /// <summary>Performs trusted work under one transparency posture.</summary>
    // SAFE: security/deterministic/conflicting-transparency-annotations
    [SecurityCritical]
    internal void DoTrustedWork()
    {
        _invocations++;
    }

    /// <summary>Returns how many times trusted work ran.</summary>
    internal int Invocations() => _invocations;
}
