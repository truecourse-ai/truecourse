using System.Diagnostics.CodeAnalysis;

// VIOLATION: code-quality/deterministic/legacy-suppressmessage-target
[assembly: SuppressMessage("Design", "CA1031", Scope = "member", Target = "ApiGateway.Violations.CodeQuality.SuppressionTargets.#Run()", Justification = "Reviewed: broad catch is intentional here.")]

// Modern documentation-ID format — must not fire.
[assembly: SuppressMessage("Design", "CA1031", Scope = "member", Target = "~M:ApiGateway.Violations.CodeQuality.SuppressionTargets.Describe", Justification = "Reviewed: broad catch is intentional here.")]

namespace ApiGateway.Violations.CodeQuality;

internal static class SuppressionTargets
{
    internal static int Run() => 0;

    internal static string Describe() => "host";
}
