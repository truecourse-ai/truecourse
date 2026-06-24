using System.Threading.Tasks;

namespace ApiGateway.Violations.Performance;

internal sealed class TaskCombinators
{
    private readonly IOutboxStore _store;

    internal TaskCombinators(IOutboxStore store)
    {
        _store = store;
    }

    internal async Task FlushAsync()
    {
        // VIOLATION: performance/deterministic/whenall-single-task
        await Task.WhenAll(PersistAsync());
    }

    internal void FlushBlocking()
    {
        // VIOLATION: performance/deterministic/waitall-single-task
        Task.WaitAll(PersistAsync());
    }

    private Task PersistAsync() => _store.SaveAsync();
}

internal interface IOutboxStore
{
    Task SaveAsync();
}
