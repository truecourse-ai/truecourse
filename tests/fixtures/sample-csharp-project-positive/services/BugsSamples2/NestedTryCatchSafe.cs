using System;

namespace Positive.Boundary.Bugs;

/// <summary>Handles a primary failure by delegating the fallback to its own method.</summary>
internal sealed class NestedTryCatchSafe
{
    /// <summary>Dispatches telemetry, falling back to local storage on failure.</summary>
    internal void Dispatch(string payload)
    {
        try
        {
            SendRemote(payload);
        }
        // SAFE: bugs/deterministic/nested-try-catch
        catch (InvalidOperationException)
        {
            WriteLocalFallback(payload);
        }
    }

    private static void SendRemote(string payload)
    {
        if (payload.Length == 0)
        {
            throw new InvalidOperationException(payload);
        }
    }

    private static void WriteLocalFallback(string payload)
    {
        try
        {
            SendRemote(payload);
        }
        catch (InvalidOperationException)
        {
            GC.KeepAlive(payload);
        }
    }
}
