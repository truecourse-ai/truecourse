using System.Threading.Tasks;

namespace Positive.Boundary.Bugs;

/// <summary>
/// Accumulates checksum bytes. It awaits into a local first, then applies the compound
/// update with no await on the right-hand side, so the read-modify-write is not split by
/// a suspension point and the rule must not fire.
/// </summary>
public sealed class RaceConditionAssignmentSafe
{
    private long _totalBytes;
    private long _lastDelta;

    /// <summary>The running total of accumulated bytes.</summary>
    public long TotalBytes => _totalBytes;

    /// <summary>The most recently applied delta.</summary>
    public long LastDelta => _lastDelta;

    /// <summary>Adds the checksum of a chunk to the running total.</summary>
    public async Task AccumulateAsync(byte[] chunk)
    {
        var delta = await ChecksumAsync(chunk);
        _lastDelta = delta;
        // SAFE: bugs/deterministic/race-condition-assignment
        _totalBytes += delta;
    }

    private static Task<long> ChecksumAsync(byte[] chunk) => Task.FromResult((long)chunk.Length);
}
