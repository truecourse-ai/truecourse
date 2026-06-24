// VIOLATION: architecture/deterministic/type-outside-namespace
// VIOLATION: code-quality/deterministic/type-in-global-namespace
internal sealed class GlobalAuditMarker
{
    internal string Reason { get; set; } = string.Empty;
}
