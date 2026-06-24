using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;

namespace UserServiceApp.Violations.Performance;

internal sealed class FileCacheRefresher
{
    private const int FlushDelayMs = 5000;

    private readonly FileSystemWatcher _watcher;
    private readonly List<CacheEntry> _entries = new();

    internal FileCacheRefresher(FileSystemWatcher watcher)
    {
        _watcher = watcher;
        // VIOLATION: performance/deterministic/event-listener-no-remove
        _watcher.Changed += OnSourceChanged;
        // VIOLATION: performance/deterministic/settimeout-setinterval-no-clear
        // VIOLATION: code-quality/deterministic/unused-constructor-result
        new Timer(_ => FlushExpired(), null, FlushDelayMs, FlushDelayMs);
    }

    internal int CountStale(string manifestJson)
    {
        var stale = 0;
        foreach (var entry in _entries)
        {
            // VIOLATION: performance/deterministic/json-parse-in-loop
            // VIOLATION: reliability/deterministic/unsafe-json-parse
            var manifest = JsonSerializer.Deserialize<CacheManifest>(manifestJson);
            if (entry.Version < manifest.Version)
            {
                stale++;
            }
        }
        return stale;
    }

    internal List<string> NormalizeKeys(IEnumerable<string> rawKeys, string keyPattern)
    {
        var normalized = new List<string>();
        foreach (var rawKey in rawKeys)
        {
            // VIOLATION: performance/deterministic/regex-in-loop
            var matcher = new Regex(keyPattern);
            if (matcher.IsMatch(rawKey))
            {
                // VIOLATION: performance/deterministic/str-replace-over-re-sub
                normalized.Add(Regex.Replace(rawKey, "cache:", "key:"));
            }
        }
        return normalized;
    }

    internal async Task RefreshAsync(string sourcePath, string cachePath)
    {
        // VIOLATION: performance/deterministic/sync-fs-in-request-handler
        var payload = File.ReadAllText(sourcePath);
        await File.WriteAllTextAsync(cachePath, payload);
    }

    private void OnSourceChanged(object sender, FileSystemEventArgs e)
    {
        _entries.RemoveAll(entry => entry.SourcePath == e.FullPath);
    }

    private void FlushExpired()
    {
        // VIOLATION: code-quality/deterministic/non-testable-datetime-provider
        _entries.RemoveAll(entry => entry.ExpiresAt < DateTime.UtcNow);
    }
}
