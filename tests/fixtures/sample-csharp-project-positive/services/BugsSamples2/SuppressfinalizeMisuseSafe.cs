using System;

namespace Positive.Boundary.Bugs;

/// <summary>A disposable that suppresses finalization from inside Dispose, the canonical place.</summary>
public class SuppressfinalizeMisuseSafe : IDisposable
{
    private bool _disposed;

    /// <summary>Releases resources once and cancels finalization correctly.</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }
        _disposed = true;
        // SAFE: bugs/deterministic/suppressfinalize-misuse
        GC.SuppressFinalize(this);
    }
}
