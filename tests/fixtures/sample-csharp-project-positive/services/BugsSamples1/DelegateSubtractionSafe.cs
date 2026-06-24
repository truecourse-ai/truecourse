using System;

namespace Positive.Boundary.Bugs;

/// <summary>Manages subscriptions to a tick event via the normal add/remove path.</summary>
public sealed class DelegateSubtractionSafe
{
    /// <summary>Event raised on each tick.</summary>
    public event EventHandler Tick;

    private int _ticks;

    /// <summary>Unsubscribes the handler — '-=' on an event is the normal unsubscribe path.</summary>
    internal void Detach()
    {
        // SAFE: bugs/deterministic/delegate-subtraction
        Tick -= OnTick;
    }

    /// <summary>Subscribes the handler.</summary>
    internal void Attach()
    {
        Tick += OnTick;
    }

    private void OnTick(object sender, EventArgs e)
    {
        _ticks++;
    }
}
