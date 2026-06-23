namespace Positive.Boundary.CodeQuality;

/// <summary>
/// An async method whose lone <c>await</c> sits inside a try/catch needs the
/// async state machine to observe the awaited result, so the await cannot be
/// elided. The rule excludes try-wrapped awaits, so redundant-async-await must
/// not fire.
/// </summary>
public class RedundantAsyncAwaitSafe
{
    /// <summary>Loads an adjustment, returning zero if the load fails.</summary>
    public async System.Threading.Tasks.Task<decimal> LoadAdjustmentAsync(decimal subtotal)
    {
        try
        {
            // SAFE: code-quality/deterministic/redundant-async-await
            return await System.Threading.Tasks.Task.FromResult(subtotal);
        }
        catch (System.InvalidOperationException)
        {
            return 0;
        }
    }
}
