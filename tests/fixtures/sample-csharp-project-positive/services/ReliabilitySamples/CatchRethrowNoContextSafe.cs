using System;
using Microsoft.Extensions.Logging;

namespace Positive.Boundary.Reliability;

/// <summary>Rethrows cancellation untouched while wrapping every other failure.</summary>
internal sealed class CatchRethrowNoContextSafe
{
    private readonly ILogger<CatchRethrowNoContextSafe> _logger;
    private readonly IRethrowWork _work;

    internal CatchRethrowNoContextSafe(ILogger<CatchRethrowNoContextSafe> logger, IRethrowWork work)
    {
        _logger = logger;
        _work = work;
    }

    internal void Execute(string input)
    {
        try
        {
            _work.Run(input);
        }
        // SAFE: reliability/deterministic/catch-rethrow-no-context
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception exception)
        {
            _logger.LogError(exception, "Work failed for {Input}", input);
            throw new InvalidOperationException($"Work failed for {input}", exception);
        }
    }
}

internal interface IRethrowWork
{
    void Run(string input);
}
