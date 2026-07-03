namespace UserServiceApp.Violations.Architecture;

/// <summary>Request payload to update a tenant's quota via the public API.</summary>
public sealed class UpdateQuotaCommand
{
    /// <summary>The tenant whose quota changes.</summary>
    public string TenantId { get; set; } = string.Empty;

    // A bound, non-nullable value type with no `required`/nullable and no default:
    // a missing field binds silently to 0 instead of failing validation.
    // VIOLATION: architecture/deterministic/value-type-action-param-under-posting
    public int MaxSeats { get; set; }
}
