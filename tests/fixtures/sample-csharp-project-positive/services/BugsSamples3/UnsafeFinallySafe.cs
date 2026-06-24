using System;

namespace Positive.Boundary.Bugs;

/// <summary>Commits a window and guards its cleanup so the finally cannot leak an exception.</summary>
public sealed class UnsafeFinallySafe
{
    private bool _windowApplied;

    /// <summary>Applies the window, marking it complete on success.</summary>
    internal void ApplyWindow()
    {
        _windowApplied = true;
    }

    /// <summary>The throw lives in a nested try/catch inside finally, so it cannot replace a propagating exception.</summary>
    internal void CommitWindow()
    {
        try
        {
            ApplyWindow();
        }
        finally
        {
            try
            {
                if (!_windowApplied)
                {
                    // SAFE: bugs/deterministic/unsafe-finally
                    throw new InvalidOperationException("window commit incomplete");
                }
            }
            catch (InvalidOperationException ex) when (ex.Message.Length > 0)
            {
                _windowApplied = false;
            }
        }
    }
}
