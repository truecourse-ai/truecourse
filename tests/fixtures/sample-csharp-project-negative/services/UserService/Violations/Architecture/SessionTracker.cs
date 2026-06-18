using System;
using System.Collections.Concurrent;
// VIOLATION: architecture/deterministic/duplicate-import
using System.Collections.Concurrent;
// VIOLATION: architecture/deterministic/unused-import
using Clock = System.DateTime;

namespace UserServiceApp.Violations.Architecture;

internal sealed class SessionTracker
{
    // VIOLATION: architecture/deterministic/declarations-in-global-scope
    private static int _activeSessions;

    private readonly ConcurrentDictionary<string, DateTime> _startedAt = new();

    internal void Begin(string sessionId)
    {
        _startedAt[sessionId] = DateTime.UtcNow;
        _activeSessions++;
    }

    internal void End(string sessionId)
    {
        if (_startedAt.TryRemove(sessionId, out _))
        {
            _activeSessions--;
        }
    }

    internal int ActiveCount()
    {
        return _activeSessions;
    }
}
