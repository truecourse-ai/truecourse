using System.Threading;

namespace ApiGateway.Violations.Reliability;

/// <summary>
/// Starts a per-request timeout. The CancellationTokenSource that backs the timeout
/// is created but never disposed, leaking a timer registration on every request.
/// </summary>
internal sealed class TimeoutGuard
{
    private int _started;

    /// <summary>Starts a timeout that fires after the given milliseconds.</summary>
    public void Start(int milliseconds)
    {
        // VIOLATION: reliability/deterministic/idisposable-not-disposed
        var cts = new CancellationTokenSource();
        cts.CancelAfter(milliseconds);
        _started++;
    }

    /// <summary>How many timeouts have been started.</summary>
    public int Started => _started;
}
