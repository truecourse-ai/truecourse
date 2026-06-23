using System.Text.Json;

namespace Positive.Boundary.Reliability;

internal sealed class UnsafeJsonParseSafe
{
    internal WebhookEnvelope? ParseEnvelope(string payload)
    {
        try
        {
            // SAFE: reliability/deterministic/unsafe-json-parse
            return JsonSerializer.Deserialize<WebhookEnvelope>(payload);
        }
        catch (JsonException)
        {
            return null;
        }
    }
}

internal sealed class WebhookEnvelope
{
    internal string? Event { get; init; }
}
