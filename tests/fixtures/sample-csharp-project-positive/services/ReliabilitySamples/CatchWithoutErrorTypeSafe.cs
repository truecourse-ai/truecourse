using System;
using System.IO;
using Microsoft.Extensions.Logging;

namespace Positive.Boundary.Reliability;

/// <summary>Catch-all that branches on the exception type via a pattern check.</summary>
internal sealed class CatchWithoutErrorTypeSafe
{
    private readonly ILogger<CatchWithoutErrorTypeSafe> _logger;
    private readonly ITypedWork _work;

    internal CatchWithoutErrorTypeSafe(ILogger<CatchWithoutErrorTypeSafe> logger, ITypedWork work)
    {
        _logger = logger;
        _work = work;
    }

    internal bool Execute(string input)
    {
        try
        {
            _work.Run(input);
            return true;
        }
        // SAFE: reliability/deterministic/catch-without-error-type
        catch (Exception exception)
        {
            if (exception is IOException)
            {
                _logger.LogWarning(exception, "Transient I/O failure for {Input}", input);
                return false;
            }

            _logger.LogError(exception, "Unrecoverable failure for {Input}", input);
            throw new InvalidOperationException($"Unrecoverable failure for {input}", exception);
        }
    }
}

internal interface ITypedWork
{
    void Run(string input);
}
