namespace Positive.Boundary.Bugs;

/// <summary>Runs work on a background thread via the asynchronous delegate pattern.</summary>
public sealed class BeginInvokeWithoutEndInvokeSafe
{
    private delegate int ProcessBatch(int batchId);

    private readonly int _factor;

    /// <summary>Creates a runner that scales each batch id by the given factor.</summary>
    public BeginInvokeWithoutEndInvokeSafe(int factor)
    {
        _factor = factor;
    }

    /// <summary>Starts the batch asynchronously and completes it, returning the result.</summary>
    internal int Run(int batchId)
    {
        ProcessBatch process = Process;
        // SAFE: bugs/deterministic/begininvoke-without-endinvoke
        var handle = process.BeginInvoke(batchId, null, null);
        return process.EndInvoke(handle);
    }

    private int Process(int batchId)
    {
        return batchId * _factor;
    }
}
