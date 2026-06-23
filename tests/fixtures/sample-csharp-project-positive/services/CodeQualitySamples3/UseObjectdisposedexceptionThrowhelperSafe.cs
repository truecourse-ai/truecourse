using System;

namespace Positive.Boundary.CodeQuality;

/// <summary>
/// A disposed-state guard expressed with the dedicated
/// <c>ObjectDisposedException.ThrowIf</c> throw helper rather than an
/// <c>if</c>/<c>throw</c> block, the exact form the rule recommends, so it must
/// not fire.
/// </summary>
public class UseObjectdisposedexceptionThrowhelperSafe
{
    private bool _disposed;

    /// <summary>Guards the instance and reports whether it remains usable.</summary>
    public bool Touch()
    {
        // SAFE: code-quality/deterministic/use-objectdisposedexception-throwhelper
        ObjectDisposedException.ThrowIf(_disposed, this);
        return true;
    }
}
