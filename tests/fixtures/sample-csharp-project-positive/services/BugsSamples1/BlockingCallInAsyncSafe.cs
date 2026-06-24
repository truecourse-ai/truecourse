using System.Threading.Tasks;

namespace Positive.Boundary.Bugs;

/// <summary>Awaits all loads and then reads each completed task's result.</summary>
public sealed class BlockingCallInAsyncSafe
{
    /// <summary>Loads a single value asynchronously.</summary>
    internal Task<int> LoadAsync(int seed)
    {
        return Task.FromResult(seed + 1);
    }

    /// <summary>Loads both values, awaiting completion before reading results.</summary>
    internal async Task<int> LoadBothAsync()
    {
        var first = LoadAsync(0);
        var second = LoadAsync(1);
        await Task.WhenAll(first, second);
        // SAFE: bugs/deterministic/blocking-call-in-async
        return first.Result + second.Result;
    }
}
