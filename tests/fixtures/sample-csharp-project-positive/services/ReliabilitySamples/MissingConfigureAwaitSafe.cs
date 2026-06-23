using System.Threading.Tasks;

namespace Positive.Boundary.Reliability;

/// <summary>Library-style async helper that awaits with ConfigureAwait(false).</summary>
public sealed class MissingConfigureAwaitSafe
{
    /// <summary>Delays for the given number of milliseconds, not capturing the context.</summary>
    internal async Task DelayAsync(int milliseconds)
    {
        // SAFE: reliability/deterministic/missing-configureawait
        await Task.Delay(milliseconds).ConfigureAwait(false);
    }
}
