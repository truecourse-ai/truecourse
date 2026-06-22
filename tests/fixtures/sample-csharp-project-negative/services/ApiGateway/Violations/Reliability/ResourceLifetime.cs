using System.IO;
using System.Threading;

namespace ApiGateway.Violations.Reliability;

/// <summary>Accumulates an upstream response in memory.</summary>
internal sealed class ResponseBuffer
{
    // Owns a disposable buffer, but the class never implements IDisposable, so the
    // stream is leaked for the lifetime of the buffer.
    // VIOLATION: reliability/deterministic/class-with-idisposable-members-not-disposable
    // VIOLATION: reliability/deterministic/disposable-field-without-idisposable
    private readonly MemoryStream _buffer = new MemoryStream();

    internal void Append(byte[] data) => _buffer.Write(data, 0, data.Length);
}

/// <summary>Checks that an upstream dependency is reachable.</summary>
internal sealed class UpstreamProbe
{
    // The overloads are stubs in this fixture and have no body.
    // VIOLATION: code-quality/deterministic/empty-function
    // VIOLATION: code-quality/deterministic/no-empty-function
    private void Ping(CancellationToken cancellationToken) { }

    private void Ping() { }

    internal void Run(CancellationToken cancellationToken)
    {
        // A cancellation token is in scope and Ping has a token-accepting overload,
        // but the call drops it, so the probe can't be cancelled.
        // VIOLATION: reliability/deterministic/cancellationtoken-not-forwarded
        Ping();
    }
}
