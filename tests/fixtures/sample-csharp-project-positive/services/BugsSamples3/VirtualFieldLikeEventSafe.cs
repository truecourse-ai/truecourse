using System;

namespace Positive.Boundary.Bugs;

/// <summary>
/// A field-like event that is *not* virtual. Because it cannot be overridden,
/// no derived type can create a second backing delegate, so the split-subscriber
/// hazard cannot arise and the rule (which only flags the <c>virtual</c> form)
/// must not fire.
/// </summary>
public class VirtualFieldLikeEventSafe
{
    /// <summary>Raised when the hub has work to report.</summary>
    // SAFE: bugs/deterministic/virtual-field-like-event
    public event EventHandler? Raised;

    /// <summary>Notifies subscribers that work is ready.</summary>
    public void Notify()
    {
        Raised?.Invoke(this, EventArgs.Empty);
    }
}
