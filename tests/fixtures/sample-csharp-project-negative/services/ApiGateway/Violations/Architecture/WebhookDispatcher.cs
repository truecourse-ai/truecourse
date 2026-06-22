using System.Net.Http;
using System.Text;
using System.Threading.Tasks;

namespace ApiGateway.Violations.Architecture;

/// <summary>
/// Dispatches outbound webhook notifications. Callers pass the subscriber endpoint as a
/// raw string, so every call site has to parse and validate the URL itself and there is
/// no validated System.Uri contract on the public surface.
/// </summary>
public sealed class WebhookDispatcher
{
    private readonly HttpClient _http;

    /// <summary>Creates a dispatcher over the supplied HTTP client.</summary>
    public WebhookDispatcher(HttpClient http) => _http = http;

    /// <summary>Posts a serialized event body to the subscriber's endpoint.</summary>
    // VIOLATION: architecture/deterministic/prefer-uri-over-string
    public async Task<bool> NotifyAsync(string uriString, string eventName, string body)
    {
        using var content = new StringContent(body, Encoding.UTF8, "application/json");
        content.Headers.Add("X-Event", eventName);
        var response = await _http.PostAsync(uriString, content);
        return response.IsSuccessStatusCode;
    }
}
