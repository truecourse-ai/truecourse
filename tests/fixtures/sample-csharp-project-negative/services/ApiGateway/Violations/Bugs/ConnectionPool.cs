namespace ApiGateway.Violations.Bugs;

internal sealed class ConnectionPool
{
    private readonly Queue<string> _idle = new();

    internal void Release(string connection)
    {
        // VIOLATION: bugs/deterministic/lock-on-public-reference
        lock (this)
        {
            _idle.Enqueue(connection);
        }
    }

    internal string Acquire()
    {
        if (_idle.Count == 0)
        {
            // VIOLATION: bugs/deterministic/raise-reserved-exception-type
            // VIOLATION: code-quality/deterministic/broad-exception-raised
            throw new Exception("pool exhausted");
        }
        return _idle.Dequeue();
    }

    internal int PackFlags(int flags)
    {
        // VIOLATION: bugs/deterministic/invalid-shift-count
        return flags << 0;
    }

    internal void Cleanup()
    {
        // VIOLATION: bugs/deterministic/suppressfinalize-misuse
        GC.SuppressFinalize(this);
    }
}
