using System;

namespace Positive.Boundary.Bugs;

/// <summary>Wraps caught failures, preserving the original as the inner exception.</summary>
public sealed class ExceptionReassignmentSafe
{
    private string _lastError = string.Empty;

    /// <summary>Last error message recorded.</summary>
    internal string LastError => _lastError;

    /// <summary>Runs work and rewraps any timeout into a new variable, keeping the original.</summary>
    internal void Replay(Action work)
    {
        try
        {
            work();
        }
        catch (TimeoutException ex)
        {
            // SAFE: bugs/deterministic/exception-reassignment
            var wrapped = new TimeoutException("journal replay timed out", ex);
            _lastError = wrapped.Message;
        }
    }
}
