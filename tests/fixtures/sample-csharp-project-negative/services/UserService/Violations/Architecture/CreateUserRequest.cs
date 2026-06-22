namespace UserServiceApp.Violations.Architecture;

/// <summary>Payload for creating a user via the public API.</summary>
public sealed class CreateUserRequest
{
    /// <summary>The user's display name.</summary>
    public string DisplayName { get; set; } = string.Empty;

    // VIOLATION: architecture/deterministic/value-type-action-param-under-posting
    public int OrganizationId { get; set; }
}
