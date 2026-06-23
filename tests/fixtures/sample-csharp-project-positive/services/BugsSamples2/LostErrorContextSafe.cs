using System;

namespace Positive.Boundary.Bugs;

/// <summary>Retries a unit of work and rethrows preserving the original stack trace.</summary>
public sealed class LostErrorContextSafe
{
    private int _attempts;
    private string _lastMessage = string.Empty;

    /// <summary>Runs the work, logging then rethrowing on failure.</summary>
    public void Run(Action work)
    {
        try
        {
            work();
        }
        catch (InvalidOperationException ex)
        {
            _lastMessage = ex.Message;
            _attempts++;
            // SAFE: bugs/deterministic/lost-error-context
            throw;
        }
    }

    /// <summary>Number of attempts that ended in a rethrow.</summary>
    public int Attempts => _attempts;

    /// <summary>The most recent failure message captured before rethrowing.</summary>
    public string LastMessage => _lastMessage;
}
