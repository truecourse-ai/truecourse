using System.Diagnostics.CodeAnalysis;

// VIOLATION: code-quality/deterministic/invalid-suppressmessage-target
[assembly: SuppressMessage("Design", "CA1031", Scope = "member", Target = "~M:ApiGateway.Violations.CodeQuality.InvalidSuppressionTarget.Vanished", Justification = "Stale: the method this targeted was renamed away.")]

namespace ApiGateway.Violations.CodeQuality;

/// <summary>Anchor type for a stale assembly-level suppression whose target no longer exists.</summary>
internal static class InvalidSuppressionTarget
{
    /// <summary>A placeholder so the type is non-empty.</summary>
    internal static int Anchor() => 0;
}
