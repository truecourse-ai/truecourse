using System;

namespace Positive.Boundary.Bugs;

/// <summary>Subscribes and unsubscribes a tick handler via a stored named method.</summary>
public sealed class AnonymousDelegateUnsubscribeSafe
{
    /// <summary>Event raised on each clock tick.</summary>
    public event EventHandler Tick;

    private int _ticks;

    /// <summary>Attaches the handler.</summary>
    public void Attach()
    {
        Tick += OnTick;
    }

    /// <summary>Detaches the handler using the same method reference it subscribed with.</summary>
    public void Detach()
    {
        // SAFE: bugs/deterministic/anonymous-delegate-unsubscribe
        Tick -= OnTick;
    }

    private void OnTick(object sender, EventArgs e)
    {
        _ticks++;
    }
}
