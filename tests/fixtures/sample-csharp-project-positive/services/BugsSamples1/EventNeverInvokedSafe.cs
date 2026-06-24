using System;

namespace Positive.Boundary.Bugs;

/// <summary>Publishes account-change notifications and actually raises the event.</summary>
public sealed class EventNeverInvokedSafe
{
    // SAFE: bugs/deterministic/event-never-invoked
    /// <summary>Raised whenever an account changes.</summary>
    public event EventHandler AccountChanged;

    /// <summary>Records a change and notifies subscribers.</summary>
    public void Record()
    {
        AccountChanged?.Invoke(this, EventArgs.Empty);
    }
}
