namespace Positive.Boundary.CodeQuality;

/// <summary>
/// A null guard that already uses <c>ArgumentNullException.ThrowIfNull</c> rather
/// than a hand-written <c>if (arg == null) throw new ArgumentNullException(...)</c>.
/// The rule only flags the manual if-null-then-throw guard, so the helper form
/// must not fire.
/// </summary>
public sealed class UseArgumentNullExceptionThrowHelperSafe
{
    /// <summary>Stores the supplied store reference after a presence check.</summary>
    public string Use(object store)
    {
        // SAFE: code-quality/deterministic/use-argumentnullexception-throwhelper
        ArgumentNullException.ThrowIfNull(store);
        return store.ToString() ?? string.Empty;
    }
}
