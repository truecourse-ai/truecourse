using System;
using System.Buffers;

namespace ApiGateway.Violations.Bugs;

// A domain exception that only offers a custom constructor, so the standard
// parameterless / message / message+inner constructors are unavailable to callers
// and serializers.
// VIOLATION: code-quality/deterministic/too-many-classes-per-file
// VIOLATION: code-quality/deterministic/filename-class-mismatch
// VIOLATION: bugs/deterministic/exception-missing-standard-constructors
public sealed class GatewayRoutingException : Exception
{
    public GatewayRoutingException(int statusCode)
    {
        StatusCode = statusCode;
    }

    public int StatusCode { get; }
}

// Throws from members where exceptions are not expected: a GetHashCode override and a
// finalizer. Both can crash the process or corrupt hashing.
internal sealed class FragileKey
{
    // Stored but never read — GetHashCode throws instead of using it.
    // VIOLATION: code-quality/deterministic/unread-private-attribute
    private readonly int _value;

    internal FragileKey(int value)
    {
        _value = value;
    }

    public override int GetHashCode()
    {
        // GetHashCode must not throw — callers using it in a dictionary will fault.
        // VIOLATION: bugs/deterministic/exception-from-unexpected-member
        throw new NotSupportedException("hashing disabled");
    }

    ~FragileKey()
    {
        // A finalizer that throws terminates the process.
        // VIOLATION: bugs/deterministic/exception-from-unexpected-member
        // VIOLATION: bugs/deterministic/finalizer-throws
        throw new InvalidOperationException("cannot finalize");
    }
}

// Owns a native buffer but exposes a public Dispose() without implementing IDisposable,
// so `using` and DI-managed disposal never call it.
internal sealed class BufferHandle
{
    private bool _freed;

    // VIOLATION: bugs/deterministic/dispose-not-implementing-idisposable
    public void Dispose()
    {
        _freed = true;
    }

    internal bool Freed => _freed;
}

// A MemoryManager that declares a finalizer — it can free the backing memory while a
// live Span still references it.
internal sealed class PooledMemory : MemoryManager<byte>
{
    private readonly byte[] _backing = new byte[256];

    public override Span<byte> GetSpan() => _backing;

    public override MemoryHandle Pin(int elementIndex = 0) => default;

    public override void Unpin()
    {
    }

    protected override void Dispose(bool disposing)
    {
    }

    // VIOLATION: bugs/deterministic/finalizer-on-memorymanager
    // VIOLATION: bugs/deterministic/empty-finalizer
    ~PooledMemory()
    {
    }
}
