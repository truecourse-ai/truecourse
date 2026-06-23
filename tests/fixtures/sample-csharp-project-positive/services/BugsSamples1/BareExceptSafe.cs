using System;

namespace Positive.Boundary.Bugs;

/// <summary>Publishes a heartbeat, binding and logging any failure.</summary>
public sealed class BareExceptSafe
{
    private readonly Action<string> _log;

    private int _missedHeartbeats;

    /// <summary>Creates the publisher with the supplied log sink.</summary>
    internal BareExceptSafe(Action<string> log)
    {
        _log = log;
    }

    /// <summary>Number of heartbeats that failed to publish.</summary>
    internal int MissedHeartbeats => _missedHeartbeats;

    /// <summary>Emits a heartbeat; a failure is bound, recorded, and logged.</summary>
    internal void PublishHeartbeat(Action emit)
    {
        try
        {
            emit();
        }
        // SAFE: bugs/deterministic/bare-except
        catch (Exception ex)
        {
            _missedHeartbeats++;
            _log(ex.Message);
        }
    }
}
