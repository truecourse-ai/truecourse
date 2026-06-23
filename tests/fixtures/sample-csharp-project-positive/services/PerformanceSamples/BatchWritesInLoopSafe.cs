using System.Collections.Generic;

namespace Positive.Boundary.Performance;

/// <summary>A unit of work that batches outbox updates into a single round-trip.</summary>
internal interface IBatchUnitOfWork
{
    /// <summary>Stages an outbox message id as dispatched.</summary>
    void MarkDispatched(int messageId);

    /// <summary>Persists all staged changes in one batch.</summary>
    int SaveChanges();
}

/// <summary>Flushes the outbox, persisting all updates after the loop in one batch.</summary>
public sealed class BatchWritesInLoopSafe
{
    private readonly IBatchUnitOfWork _work;

    /// <summary>Creates the flusher over a batching unit of work.</summary>
    public BatchWritesInLoopSafe(IBatchUnitOfWork work)
    {
        _work = work;
    }

    /// <summary>Marks each message dispatched, then saves once after the loop.</summary>
    public int MarkDispatched(IReadOnlyList<int> messageIds)
    {
        foreach (var id in messageIds)
        {
            _work.MarkDispatched(id);
        }

        // SAFE: performance/deterministic/batch-writes-in-loop
        return _work.SaveChanges();
    }
}
