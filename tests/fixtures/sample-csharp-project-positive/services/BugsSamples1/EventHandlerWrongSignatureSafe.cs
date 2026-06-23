using System;

namespace Positive.Boundary.Bugs;

/// <summary>Payload carrying the id of the batch that finished.</summary>
internal sealed class BatchCompletedEventArgs : EventArgs
{
    /// <summary>Creates the payload for the given batch id.</summary>
    public BatchCompletedEventArgs(int batchId) => BatchId = batchId;

    /// <summary>The id of the batch that completed.</summary>
    public int BatchId { get; }
}

/// <summary>A custom event delegate that follows the conventional (sender, args) shape.</summary>
internal delegate void BatchCompletedCallback(object sender, BatchCompletedEventArgs e);

/// <summary>Raises a completion event typed with a conventionally-shaped custom delegate.</summary>
public sealed class EventHandlerWrongSignatureSafe
{
    // SAFE: bugs/deterministic/event-handler-wrong-signature
    /// <summary>Raised when a batch completes.</summary>
    public event BatchCompletedCallback Completed;

    /// <summary>Marks the given batch complete and notifies subscribers.</summary>
    public void Complete(int batchId)
    {
        Completed?.Invoke(this, new BatchCompletedEventArgs(batchId));
    }
}
