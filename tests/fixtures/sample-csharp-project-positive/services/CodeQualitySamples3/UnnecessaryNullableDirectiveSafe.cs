// SAFE: code-quality/deterministic/unnecessary-nullable-directive
#nullable enable annotations

namespace Positive.Boundary.CodeQuality;

/// <summary>
/// Opens a scoped nullable context (annotations only), which carries a target
/// token and therefore does not merely restate the whole project-level context.
/// The unnecessary-nullable-directive rule must not fire.
/// </summary>
public class UnnecessaryNullableDirectiveSafe
{
    /// <summary>An optional correlation id.</summary>
    public string? CorrelationId { get; set; }
}
