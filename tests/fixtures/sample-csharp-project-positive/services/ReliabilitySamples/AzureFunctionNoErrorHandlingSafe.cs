using System;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Extensions.Logging;

namespace Positive.Boundary.Reliability;

/// <summary>Azure Function whose fallible work is bracketed in try/catch.</summary>
internal sealed class AzureFunctionNoErrorHandlingSafe
{
    private readonly ILogger<AzureFunctionNoErrorHandlingSafe> _logger;
    private readonly IProcessor _processor;

    internal AzureFunctionNoErrorHandlingSafe(ILogger<AzureFunctionNoErrorHandlingSafe> logger, IProcessor processor)
    {
        _logger = logger;
        _processor = processor;
    }

    [Function("ProcessQueue")]
    // SAFE: reliability/deterministic/azure-function-no-error-handling
    internal void ProcessQueue([QueueTrigger("orders")] string message)
    {
        try
        {
            _processor.Handle(message);
        }
        catch (InvalidOperationException exception)
        {
            _logger.LogError(exception, "Failed to process queue message {Message}", message);
        }
    }
}

internal interface IProcessor
{
    void Handle(string message);
}
