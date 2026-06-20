namespace UserServiceApp.Violations.Architecture;

/// <summary>Describes a registered webhook endpoint.</summary>
public sealed class WebhookEndpoint
{
    // VIOLATION: architecture/deterministic/uri-property-as-string
    public string CallbackUrl { get; set; } = string.Empty;

    /// <summary>Build the absolute delivery URL for a payload id.</summary>
    // VIOLATION: architecture/deterministic/uri-return-as-string
    public string BuildDeliveryUrl(int payloadId) => $"{CallbackUrl}/{payloadId}";
}
