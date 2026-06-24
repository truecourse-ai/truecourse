using System;
using System.Threading;

namespace Positive.Boundary.Performance;

/// <summary>Periodically flushes expired entries via a stored timer.</summary>
public sealed class SetTimeoutSetIntervalNoClearSafe : IDisposable
{
    private const int FlushDelayMs = 1000;

    private readonly Timer _timer;

    /// <summary>Starts the flush timer, keeping a reference to it.</summary>
    public SetTimeoutSetIntervalNoClearSafe()
    {
        // SAFE: performance/deterministic/settimeout-setinterval-no-clear
        _timer = new Timer(_ => FlushExpired(), null, FlushDelayMs, FlushDelayMs);
    }

    /// <summary>Stops and disposes the timer.</summary>
    public void Dispose()
    {
        _timer.Dispose();
    }

    private void FlushExpired()
    {
        _ = _timer;
    }
}
