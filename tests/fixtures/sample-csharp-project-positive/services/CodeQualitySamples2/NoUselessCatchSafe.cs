using System;

namespace Positive.Boundary.CodeQuality;

/// <summary>
/// A catch clause guarded by a <c>when</c> filter that rethrows only the
/// targeted failures. The no-useless-catch rule excludes filtered clauses, so a
/// <c>catch … when (…)</c> that rethrows must not fire.
/// </summary>
public sealed class NoUselessCatchSafe
{
    /// <summary>Runs the action, letting only transient timeouts propagate.</summary>
    internal void Run(Action work)
    {
        try
        {
            work();
        }
        // SAFE: code-quality/deterministic/no-useless-catch
        catch (TimeoutException ex) when (ex.Data.Count == 0)
        {
            throw;
        }
    }
}
