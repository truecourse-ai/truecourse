namespace Positive.Boundary.CodeQuality;

/// <summary>
/// An event declared with the BCL <c>EventHandler&lt;TEventArgs&gt;</c> generic,
/// the form the rule recommends, so the non-generic-event-handler check must
/// not fire.
/// </summary>
public class NonGenericEventHandlerSafe
{
    // SAFE: code-quality/deterministic/non-generic-event-handler
    internal event System.EventHandler<System.EventArgs> Flushed;

    /// <summary>Raises the <see cref="Flushed"/> event.</summary>
    internal void RaiseFlushed()
    {
        Flushed?.Invoke(this, System.EventArgs.Empty);
    }
}
