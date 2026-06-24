using System;
using System.Threading;
using System.Threading.Tasks;

namespace Positive.Boundary.Bugs;

/// <summary>Runs a worker loop that breaks out cleanly when cancelled.</summary>
public sealed class CancellationExceptionNotReraisedSafe
{
    private int _iterations;
    private bool _stopped;

    /// <summary>Loops until cancelled, then records the stop and exits the loop.</summary>
    internal async Task RunAsync(CancellationToken token)
    {
        while (true)
        {
            try
            {
                await Task.Delay(1, token);
                _iterations++;
            }
            // SAFE: bugs/deterministic/cancellation-exception-not-reraised
            catch (OperationCanceledException)
            {
                _stopped = true;
                break;
            }
        }
    }

    /// <summary>Whether the worker observed a cancellation.</summary>
    internal bool Stopped => _stopped;
}
