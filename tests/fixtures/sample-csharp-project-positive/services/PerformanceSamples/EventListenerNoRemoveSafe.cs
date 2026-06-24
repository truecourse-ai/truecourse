using System;
using System.IO;

namespace Positive.Boundary.Performance;

/// <summary>Watches a source file and unsubscribes on disposal.</summary>
public sealed class EventListenerNoRemoveSafe : IDisposable
{
    private readonly FileSystemWatcher _watcher;
    private int _changeCount;

    /// <summary>Subscribes to the watcher's change notifications.</summary>
    public EventListenerNoRemoveSafe(FileSystemWatcher watcher)
    {
        _watcher = watcher;
        // SAFE: performance/deterministic/event-listener-no-remove
        _watcher.Changed += OnSourceChanged;
    }

    /// <summary>The number of change notifications seen so far.</summary>
    internal int ChangeCount => _changeCount;

    /// <summary>Detaches the handler so the watcher no longer roots this object.</summary>
    public void Dispose()
    {
        _watcher.Changed -= OnSourceChanged;
    }

    private void OnSourceChanged(object sender, FileSystemEventArgs e)
    {
        if (e.FullPath.Length > 0)
        {
            _changeCount++;
        }
    }
}
