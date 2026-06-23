using System.Net.Http;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Extensions.Logging;

namespace ApiGateway.Violations.Performance;

/// <summary>
/// A timer-triggered notifier. It builds a fresh HttpClient on every invocation, so under
/// load the function leaks sockets and exhausts the connection pool.
/// </summary>
public sealed class NotifyFunction
{
    private readonly ILogger<NotifyFunction> _logger;

    public NotifyFunction(ILogger<NotifyFunction> logger)
    {
        _logger = logger;
    }

    /// <summary>Runs the timer-triggered notification sweep.</summary>
    // VIOLATION: reliability/deterministic/azure-function-no-error-handling
    [Function("Notify")]
    public void Run()
    {
        _logger.LogInformation("Dispatching notifications");

        // VIOLATION: performance/deterministic/azure-function-client-recreated
        // VIOLATION: reliability/deterministic/http-call-no-timeout
        using var client = new HttpClient();
        client.CancelPendingRequests();
    }
}
