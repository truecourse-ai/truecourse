using System.Threading;

namespace Positive.Boundary.CodeQuality;

/// <summary>
/// Uses the ThrowIfCancellationRequested helper directly instead of a manual
/// IsCancellationRequested check plus throw, so the rewrite rule must not fire.
/// </summary>
public class UseThrowIfCancellationRequestedSafe
{
    /// <summary>Aborts the step if <paramref name="token"/> is cancelled.</summary>
    internal void Step(CancellationToken token)
    {
        // SAFE: code-quality/deterministic/use-throwifcancellationrequested
        token.ThrowIfCancellationRequested();
    }
}
