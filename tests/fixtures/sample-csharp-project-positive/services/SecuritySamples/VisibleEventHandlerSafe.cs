using System;

namespace Positive.Boundary.Security;

/// <summary>Wires an internal callback to a domain event.</summary>
public sealed class VisibleEventHandlerSafe
{
    private int _count;

    /// <summary>Increments the processed-event counter.</summary>
    internal int ProcessedCount() => _count;

    // SAFE: security/deterministic/visible-event-handler
    private void OnRaised(object sender, EventArgs e)
    {
        _count = sender is null || e is null ? _count : _count + 1;
    }

    /// <summary>Subscribes the private handler to the supplied event source.</summary>
    internal void Attach(Action<EventHandler> subscribe) => subscribe(OnRaised);
}
