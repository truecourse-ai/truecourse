using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;

namespace UserServiceApp.Violations.Reliability;

internal sealed class Diagnostics
{
    private readonly Thread _worker;
    private readonly ILogger _logger;
    private readonly List<int> _stored = new();
    private long _recomputeTicks;

    internal Diagnostics(Thread worker, ILogger logger)
    {
        _worker = worker;
        _logger = logger;
    }

    internal IReadOnlyList<int> Stored => _stored;

    internal long RecomputeTicks => _recomputeTicks;

    internal nint RawHandle(SafeHandle handle)
    {
        // VIOLATION: reliability/deterministic/dangerous-get-handle
        return handle.DangerousGetHandle();
    }

    internal void Pause()
    {
        // VIOLATION: reliability/deterministic/thread-resume-suspend
        _worker.Suspend();
    }

    internal void KickOff()
    {
        // VIOLATION: reliability/deterministic/task-without-taskscheduler
        Task.Factory.StartNew(() => Recompute());
    }

    internal void Persist(Record record)
    {
        try
        {
            Store(record);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to store record {Id}", record.Id);
            // VIOLATION: reliability/deterministic/exception-logged-and-rethrown
            throw;
        }
    }

    internal Stream OpenSnapshot(string path)
    {
        using (var stream = File.OpenRead(path))
        {
            // VIOLATION: reliability/deterministic/return-disposable-from-using
            return stream;
        }
    }

    private void Recompute()
    {
        _recomputeTicks = Environment.TickCount64;
    }

    private void Store(Record record)
    {
        _stored.Add(record.Id);
    }
}

internal interface ILogger
{
    void LogError(Exception exception, string message, params object[] args);
}

internal sealed class Record
{
    internal int Id { get; init; }
}
