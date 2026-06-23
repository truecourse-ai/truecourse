using System.Net.Http;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Extensions.Logging;

namespace Positive.Boundary.Performance;

/// <summary>
/// A timer-triggered notifier that reuses an injected HttpClient across invocations
/// instead of constructing one per call.
/// </summary>
public sealed class AzureFunctionClientRecreatedSafe
{
    private readonly HttpClient _client;
    private readonly ILogger<AzureFunctionClientRecreatedSafe> _logger;

    /// <summary>Creates the function with a shared, injected HttpClient and logger.</summary>
    public AzureFunctionClientRecreatedSafe(HttpClient client, ILogger<AzureFunctionClientRecreatedSafe> logger)
    {
        _client = client;
        _logger = logger;
    }

    /// <summary>Runs the notification sweep, reusing the shared client.</summary>
    [Function("Notify")]
    public void Run()
    {
        try
        {
            // SAFE: performance/deterministic/azure-function-client-recreated
            _client.CancelPendingRequests();
        }
        catch (HttpRequestException ex)
        {
            _logger.LogError(ex, "Failed to cancel pending notification requests");
        }
    }
}
