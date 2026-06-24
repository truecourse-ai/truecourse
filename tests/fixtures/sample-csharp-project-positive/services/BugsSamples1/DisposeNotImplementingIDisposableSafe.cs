using System;

namespace Positive.Boundary.Bugs;

/// <summary>Owns a native buffer and releases it through IDisposable.</summary>
public sealed class DisposeNotImplementingIDisposableSafe : IDisposable
{
    private bool _freed;

    /// <summary>Releases the buffer — wired through IDisposable so 'using' invokes it.</summary>
    // SAFE: bugs/deterministic/dispose-not-implementing-idisposable
    public void Dispose()
    {
        _freed = true;
    }

    /// <summary>Whether the buffer has been released.</summary>
    public bool Freed => _freed;
}
