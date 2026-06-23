using System;

namespace ApiGateway.Violations.Bugs;

/// <summary>Completion payload carrying the id of the batch that finished.</summary>
internal sealed class BatchCompletedEventArgs : EventArgs
{
    public BatchCompletedEventArgs(int batchId) => BatchId = batchId;

    public int BatchId { get; }
}

/// <summary>
/// Handler delegate for <see cref="BackgroundBatchRunner.Completed"/>. It takes a
/// string source instead of the conventional object sender, so ordinary event
/// wiring and designer tooling cannot bind to it.
/// </summary>
internal delegate void BatchCompletedHandler(string source, BatchCompletedEventArgs e);

/// <summary>
/// Runs a batch on a background thread using the asynchronous delegate pattern and
/// raises a completion event. The delegate is started but never completed, and the
/// completion event is typed with a non-conventional handler delegate.
/// </summary>
internal sealed class BackgroundBatchRunner
{
    private readonly int _factor;

    public BackgroundBatchRunner(int factor) => _factor = factor;

    private delegate int ProcessBatch(int batchId);

    // VIOLATION: bugs/deterministic/event-handler-wrong-signature
    // VIOLATION: code-quality/deterministic/non-generic-event-handler
    public event BatchCompletedHandler Completed;

    /// <summary>Starts processing the batch and notifies subscribers when done.</summary>
    public void Run(int batchId)
    {
        ProcessBatch process = Process;

        // VIOLATION: bugs/deterministic/begininvoke-without-endinvoke
        process.BeginInvoke(batchId, null, null);

        Completed?.Invoke(nameof(BackgroundBatchRunner), new BatchCompletedEventArgs(batchId));
    }

    private int Process(int batchId) => batchId * _factor;
}
