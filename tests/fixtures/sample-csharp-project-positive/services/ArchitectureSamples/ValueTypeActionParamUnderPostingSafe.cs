namespace Positive.Boundary.Architecture;

/// <summary>Payload for creating a user via the public API.</summary>
public sealed class ValueTypeActionParamUnderPostingSafe
{
    /// <summary>The user's display name.</summary>
    public string DisplayName { get; set; } = string.Empty;

    // SAFE: architecture/deterministic/value-type-action-param-under-posting
    /// <summary>The owning organization; required so a missing field fails validation.</summary>
    public required int OrganizationId { get; set; }
}
