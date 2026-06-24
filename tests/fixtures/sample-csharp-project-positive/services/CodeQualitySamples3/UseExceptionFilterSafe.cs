using System;

namespace Positive.Boundary.CodeQuality;

/// <summary>
/// A catch clause that already uses a <c>when</c> exception filter to decide
/// whether to handle the exception, instead of entering the handler and
/// conditionally bare-rethrowing. The rule only flags the
/// <c>if (...) throw;</c> shape, so the filtered catch must not fire.
/// </summary>
public sealed class UseExceptionFilterSafe
{
    /// <summary>Runs <paramref name="work"/>, recovering only when the codes match.</summary>
    public bool Replay(Action work, int expected)
    {
        try
        {
            work();
            return true;
        }
        // SAFE: code-quality/deterministic/use-exception-filter
        catch (InvalidOperationException ex) when (ex.HResult == expected)
        {
            return false;
        }
    }
}
