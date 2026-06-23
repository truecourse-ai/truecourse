using System.Threading.Tasks;

namespace Positive.Boundary.Performance;

/// <summary>Awaits a single task directly rather than routing it through the array combinator.</summary>
public sealed class WhenAllSingleTaskSafe
{
    private readonly IWriteSink _sink;

    /// <summary>Creates the flusher over the given sink.</summary>
    public WhenAllSingleTaskSafe(IWriteSink sink)
    {
        _sink = sink;
    }

    /// <summary>Flushes the single pending write.</summary>
    public async Task FlushAsync()
    {
        // SAFE: performance/deterministic/whenall-single-task
        await _sink.PersistAsync();
    }
}

/// <summary>A sink that persists outbound writes.</summary>
public interface IWriteSink
{
    /// <summary>Persists the pending write.</summary>
    Task PersistAsync();
}
