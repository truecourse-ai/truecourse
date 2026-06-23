#nullable enable
// VIOLATION: code-quality/deterministic/redundant-nullable-directive
#nullable enable

namespace ApiGateway.Violations.CodeQuality;

/// <summary>
/// Holds an optional correlation id. The file opens the nullable context and then opens it
/// again — the second directive restates a context already in effect and does nothing.
/// </summary>
internal sealed class NullableDirectives
{
    /// <summary>An optional correlation id.</summary>
    public string? CorrelationId { get; set; }
}
