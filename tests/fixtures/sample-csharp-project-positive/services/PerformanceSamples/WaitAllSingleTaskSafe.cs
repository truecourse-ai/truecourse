using System.Threading.Tasks;

namespace Positive.Boundary.Performance;

/// <summary>Blocks on a batch of tasks through the array combinator only when there is more than one.</summary>
public sealed class WaitAllSingleTaskSafe
{
    private readonly IFlushTarget _target;

    /// <summary>Creates the flusher over the given target.</summary>
    public WaitAllSingleTaskSafe(IFlushTarget target)
    {
        _target = target;
    }

    /// <summary>Waits for both pending writes to complete.</summary>
    public void FlushBlocking()
    {
        // SAFE: performance/deterministic/waitall-single-task
        Task.WaitAll(_target.PersistAsync(), _target.MirrorAsync());
    }
}

/// <summary>A target that persists and mirrors outbound writes.</summary>
public interface IFlushTarget
{
    /// <summary>Persists the pending write.</summary>
    Task PersistAsync();

    /// <summary>Mirrors the pending write to the replica.</summary>
    Task MirrorAsync();
}
