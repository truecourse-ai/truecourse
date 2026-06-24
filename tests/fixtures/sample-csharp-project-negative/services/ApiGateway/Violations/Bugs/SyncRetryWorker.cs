namespace ApiGateway.Violations.Bugs;

internal class SyncRetryWorker
{
    private const int PollDelayMs = 250;
    private const int FlushDelayMs = 50;
    private const int PumpIntervalMs = 500;
    private const int ChunkDelayMs = 10;

    private bool _drained;
    private long _totalBytes;
    private int _cancelledRestarts;
    private int _activeLoads;
    private int _cacheVersion;

    internal long TotalBytes => _totalBytes;
    internal int CancelledRestarts => _cancelledRestarts;
    internal int ActiveLoads => _activeLoads;
    internal int CacheVersion => _cacheVersion;

    internal void MarkDrained()
    {
        _drained = true;
    }

    internal async Task WaitForDrainAsync()
    {
        // VIOLATION: bugs/deterministic/async-busy-wait
        while (!_drained)
        {
            // VIOLATION: reliability/deterministic/floating-promise
            Task.Delay(PollDelayMs);
        }
        await Task.Delay(FlushDelayMs);
    }

    internal async Task WarmCachesAsync(Task[] warmups)
    {
        // VIOLATION: bugs/deterministic/blocking-call-in-async
        Task.WaitAll(warmups);
        await Task.Delay(FlushDelayMs);
    }

    // VIOLATION: bugs/deterministic/async-void-function
    // VIOLATION: code-quality/deterministic/async-method-naming
    internal async void RefreshCacheOnTimer()
    {
        await Task.Delay(FlushDelayMs);
        _cacheVersion++;
    }

    internal async Task AccumulateAsync(byte[] chunk)
    {
        // VIOLATION: bugs/deterministic/race-condition-assignment
        _totalBytes += await ChecksumAsync(chunk);
    }

    internal async Task RunPumpAsync(CancellationToken token)
    {
        while (true)
        {
            try
            {
                await PumpOnceAsync(token);
            }
            // VIOLATION: bugs/deterministic/cancellation-exception-not-reraised
            catch (OperationCanceledException)
            {
                _cancelledRestarts++;
            }
        }
    }

    internal Task<string> LoadManifestAsync(string region)
    {
        _activeLoads++;
        try
        {
            // VIOLATION: bugs/deterministic/missing-return-await
            return FetchManifestAsync(region);
        }
        finally
        {
            _activeLoads--;
        }
    }

    private static async Task<long> ChecksumAsync(byte[] chunk)
    {
        await Task.Delay(ChunkDelayMs);
        return chunk.Length;
    }

    private async Task PumpOnceAsync(CancellationToken token)
    {
        await Task.Delay(PumpIntervalMs, token);
        _totalBytes += 1;
    }

    private static async Task<string> FetchManifestAsync(string region)
    {
        await Task.Delay(ChunkDelayMs);
        return region.ToUpperInvariant();
    }
}
