using System;

namespace UserServiceApp.Violations.Bugs;

/// <summary>
/// Publishes account-change notifications. The raise site was removed during a
/// refactor but the event was left behind, so subscribers never hear anything.
/// </summary>
internal sealed class ChangeNotifier
{
    private int _changeCount;

    // VIOLATION: bugs/deterministic/event-never-invoked
    public event EventHandler AccountChanged;

    /// <summary>Records that an account changed.</summary>
    public void Record() => _changeCount++;

    /// <summary>The number of changes recorded so far.</summary>
    public int ChangeCount => _changeCount;
}
