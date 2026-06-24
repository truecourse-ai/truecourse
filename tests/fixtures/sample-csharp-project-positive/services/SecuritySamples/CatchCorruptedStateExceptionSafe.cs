using System;

namespace Positive.Boundary.Security;

/// <summary>Wraps a native callback in a normal handler without re-enabling corrupted-state exceptions.</summary>
public sealed class CatchCorruptedStateExceptionSafe
{
    private string _lastError = "ok";

    /// <summary>Runs the callback and records any ordinary exception.</summary>
    // SAFE: security/deterministic/catch-corrupted-state-exception
    internal void RunNativeCallback(Action callback)
    {
        try
        {
            callback();
        }
        catch (Exception ex)
        {
            _lastError = ex.Message;
        }
    }

    /// <summary>Returns the last recorded error, or "ok".</summary>
    internal string Status() => _lastError;
}
