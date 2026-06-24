using System.Threading;

namespace Positive.Boundary.Reliability;

/// <summary>Probe that forwards its cancellation token to the token-accepting overload.</summary>
internal sealed class CancellationtokenNotForwardedSafe
{
    private int _pings;

    private void Ping(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        _pings++;
    }

    private void Ping() => _pings++;

    internal int Run(CancellationToken cancellationToken)
    {
        // SAFE: reliability/deterministic/cancellationtoken-not-forwarded
        Ping(cancellationToken);
        return _pings;
    }
}
