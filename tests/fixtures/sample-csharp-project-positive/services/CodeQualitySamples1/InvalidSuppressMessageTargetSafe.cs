using System.Diagnostics.CodeAnalysis;

// SAFE: code-quality/deterministic/invalid-suppressmessage-target
[assembly: SuppressMessage("Design", "CA1031", Scope = "member", Target = "~M:Positive.Boundary.CodeQuality.InvalidSuppressMessageTargetSafe.Anchor", Justification = "Targets a method that exists, so the suppression resolves.")]

namespace Positive.Boundary.CodeQuality;

/// <summary>
/// A global SuppressMessage whose documentation-ID Target resolves to a real method in
/// the compilation, so the suppression is effective and invalid-suppressmessage-target
/// must not fire.
/// </summary>
public static class InvalidSuppressMessageTargetSafe
{
    /// <summary>The method named by the suppression target above.</summary>
    public static int Anchor() => 0;
}
