using System;

namespace Positive.Boundary.CodeQuality;

/// <summary>
/// An event raise that already passes the shared <c>EventArgs.Empty</c> singleton
/// rather than allocating <c>new EventArgs()</c>. The rule only flags the
/// throwaway <c>new EventArgs()</c> allocation, so the singleton form must not fire.
/// </summary>
public sealed class UseEventArgsEmptySafe
{
    /// <summary>Raised when a flush completes; carries no payload.</summary>
    public event EventHandler? Flushed;

    /// <summary>Raises the <see cref="Flushed"/> event with no payload.</summary>
    public void Flush()
    {
        // SAFE: code-quality/deterministic/use-eventargs-empty
        Flushed?.Invoke(this, EventArgs.Empty);
    }
}
