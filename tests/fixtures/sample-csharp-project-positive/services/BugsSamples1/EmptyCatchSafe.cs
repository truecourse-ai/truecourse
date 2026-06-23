using System;
using System.Threading;

namespace Positive.Boundary.Bugs;

/// <summary>Drains work, ignoring only the standard cancellation signal.</summary>
public sealed class EmptyCatchSafe
{
    /// <summary>Runs the pump until cancelled, swallowing only cancellation.</summary>
    internal void Pump(Action body, CancellationToken token)
    {
        try
        {
            token.ThrowIfCancellationRequested();
            body();
        }
        // SAFE: bugs/deterministic/empty-catch
        catch (OperationCanceledException) { }
    }
}
