// VIOLATION: architecture/deterministic/type-outside-namespace
internal sealed class GlobalAuditMarker
{
    internal string Reason { get; set; } = string.Empty;
}
