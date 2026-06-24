using System;
using System.Threading.Tasks;

namespace Positive.Boundary.Bugs;

/// <summary>An async event handler — the one legitimate async void shape.</summary>
public sealed class AsyncVoidFunctionSafe
{
    private const int FlushDelayMs = 25;

    private int _flushCount;

    /// <summary>Current number of completed flushes.</summary>
    internal int FlushCount => _flushCount;

    // SAFE: bugs/deterministic/async-void-function
    private async void OnTimerElapsedAsync(object sender, EventArgs e)
    {
        if (sender is null || e is null)
        {
            return;
        }
        await Task.Delay(FlushDelayMs);
        _flushCount++;
    }

    /// <summary>Subscribes the handler to the supplied event source.</summary>
    internal void Subscribe(Action<EventHandler> register)
    {
        register(OnTimerElapsedAsync);
    }
}
