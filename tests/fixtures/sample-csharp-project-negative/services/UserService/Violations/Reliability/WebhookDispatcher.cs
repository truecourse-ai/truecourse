using System.Collections.Generic;
using System.Net.Http;
using System.Text.Json;
using System.Threading.Tasks;

namespace UserServiceApp.Violations.Reliability;

// VIOLATION: reliability/deterministic/disposable-field-without-idisposable
// VIOLATION: reliability/deterministic/class-with-idisposable-members-not-disposable
internal sealed class WebhookDispatcher
{
    private readonly HttpClient _client;
    private readonly List<string> _endpoints;

    internal WebhookDispatcher(IEnumerable<string> endpoints)
    {
        // VIOLATION: reliability/deterministic/http-call-no-timeout
        _client = new HttpClient();
        _endpoints = new List<string>(endpoints);
    }

    internal WebhookEnvelope? ParseEnvelope(string payload)
    {
        // VIOLATION: reliability/deterministic/unsafe-json-parse
        return JsonSerializer.Deserialize<WebhookEnvelope>(payload);
    }

    internal void NotifyDeleted(string endpoint, string userId)
    {
        // VIOLATION: reliability/deterministic/floating-promise
        _client.PostAsync(endpoint, BuildBody(userId));
    }

    internal void Broadcast(string message)
    {
        var deliveries = new List<Task>();
        foreach (var endpoint in _endpoints)
        {
            deliveries.Add(_client.PostAsync(endpoint, new StringContent(message)));
        }
        // VIOLATION: reliability/deterministic/promise-all-no-error-handling
        Task.WhenAll(deliveries);
    }

    private static StringContent BuildBody(string userId)
    {
        return new StringContent(JsonSerializer.Serialize(new { deletedUserId = userId }));
    }
}
