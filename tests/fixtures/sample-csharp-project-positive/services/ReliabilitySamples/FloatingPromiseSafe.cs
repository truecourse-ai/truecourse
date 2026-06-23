using System.Threading.Tasks;

namespace Positive.Boundary.Reliability;

/// <summary>Awaits its async work so the task is observed, not left floating.</summary>
public sealed class FloatingPromiseSafe
{
    private readonly IWorkQueue _queue;

    /// <summary>Creates the runner over a work queue.</summary>
    internal FloatingPromiseSafe(IWorkQueue queue)
    {
        _queue = queue;
    }

    /// <summary>Enqueues the item and waits for the queue to accept it.</summary>
    internal async Task EnqueueAsync(string item)
    {
        // SAFE: reliability/deterministic/floating-promise
        await _queue.PushAsync(item);
    }
}

/// <summary>A queue that accepts work items asynchronously.</summary>
public interface IWorkQueue
{
    /// <summary>Pushes an item onto the queue.</summary>
    Task PushAsync(string item);
}
