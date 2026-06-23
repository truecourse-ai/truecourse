using System;

namespace Positive.Boundary.Reliability;

/// <summary>Logs a failure and handles it locally instead of rethrowing.</summary>
public sealed class ExceptionLoggedAndRethrownSafe
{
    private readonly IErrorSink _sink;

    /// <summary>Creates the handler over an error sink.</summary>
    internal ExceptionLoggedAndRethrownSafe(IErrorSink sink)
    {
        _sink = sink;
    }

    /// <summary>Runs the work, logging and swallowing failure; true on success.</summary>
    internal bool TryRun(Action work)
    {
        try
        {
            work();
            return true;
        }
        catch (InvalidOperationException ex)
        {
            // SAFE: reliability/deterministic/exception-logged-and-rethrown
            _sink.LogError(ex, "work failed");
            return false;
        }
    }
}

/// <summary>Sink that records errors for diagnostics.</summary>
public interface IErrorSink
{
    /// <summary>Records an error with a contextual message.</summary>
    void LogError(Exception exception, string message);
}
