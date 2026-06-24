using System.Threading;
using System.Threading.Tasks;

namespace Positive.Boundary.Bugs;

/// <summary>Replicates a payload to a target with the token positioned last.</summary>
public sealed class CancellationTokenNotLastSafe
{
    private int _calls;

    /// <summary>Replicates to the target, taking the cancellation token last.</summary>
    // SAFE: bugs/deterministic/cancellation-token-not-last
    internal Task ReplicateAsync(string target, CancellationToken token)
    {
        _calls += target.Length;
        return Task.Delay(_calls, token);
    }
}
