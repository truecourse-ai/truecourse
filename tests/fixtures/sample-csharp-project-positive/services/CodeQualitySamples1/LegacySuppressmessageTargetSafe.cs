using System.Diagnostics.CodeAnalysis;

// SAFE: code-quality/deterministic/legacy-suppressmessage-target
[assembly: SuppressMessage("Design", "CA1031", Scope = "member", Target = "~M:Positive.Boundary.CodeQuality.LegacySuppressmessageTargetSafe.Describe", Justification = "Reviewed: the broad catch is intentional for the diagnostic path.")]

namespace Positive.Boundary.CodeQuality;

/// <summary>
/// Carries a global <c>[SuppressMessage]</c> whose <c>Target</c> uses the modern
/// documentation-ID format (<c>~M:</c> prefix). The rule only flags the legacy
/// FxCop <c>Namespace.Type.#Member()</c> shape, so the <c>~</c>-prefixed form
/// must not fire.
/// </summary>
internal static class LegacySuppressmessageTargetSafe
{
    /// <summary>Returns a short label for the given code.</summary>
    internal static string Describe(int code)
    {
        return code > 0 ? "active" : "idle";
    }
}
