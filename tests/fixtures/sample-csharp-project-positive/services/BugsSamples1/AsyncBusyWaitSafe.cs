using System.Threading.Tasks;

namespace Positive.Boundary.Bugs;

/// <summary>Polls a readiness flag while yielding the thread between checks.</summary>
public sealed class AsyncBusyWaitSafe
{
    private const int PollDelayMs = 100;

    private bool _ready;

    /// <summary>Marks the worker as ready.</summary>
    internal void MarkReady()
    {
        _ready = true;
    }

    /// <summary>Waits until the worker reports ready, yielding between polls.</summary>
    internal async Task WaitForReadyAsync()
    {
        // SAFE: bugs/deterministic/async-busy-wait
        while (!_ready)
        {
            await Task.Delay(PollDelayMs);
        }
    }
}
