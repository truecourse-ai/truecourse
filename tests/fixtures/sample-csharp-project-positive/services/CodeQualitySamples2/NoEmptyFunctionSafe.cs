namespace Positive.Boundary.CodeQuality;

/// <summary>
/// A method whose braces hold only a comment explaining why nothing runs. The
/// no-empty-function rule treats a documented empty body as intentional and
/// must not fire.
/// </summary>
public sealed class NoEmptyFunctionSafe
{
    /// <summary>Hook invoked once warm-up has finished; intentionally a no-op.</summary>
    internal void OnWarmUpComplete()
    {
        // SAFE: code-quality/deterministic/no-empty-function
        // Warm-up needs no teardown today; the body is left empty on purpose.
    }
}
