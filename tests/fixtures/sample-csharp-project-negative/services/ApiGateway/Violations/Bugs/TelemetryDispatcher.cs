namespace ApiGateway.Violations.Bugs;

internal interface ITelemetryLogger
{
    void LogWarning(string message, params object[] args);
}

internal class TelemetryDispatcher
{
    private readonly ITelemetryLogger _logger;

    private int _failureCount;
    private int _missedHeartbeats;
    private bool _degraded;
    private int _checkpointFailures;
    private Exception? _lastError;
    private bool _windowApplied;
    private int _journalCursor;
    private int _heartbeatSequence;
    private int _checkpointSequence;
    private int _exportSequence;
    private int _fallbackWrites;
    private int _snapshotSequence;
    private int _lastBatchSize;

    internal TelemetryDispatcher(ITelemetryLogger logger)
    {
        _logger = logger;
    }

    internal bool Degraded => _degraded;
    internal Exception? LastError => _lastError;
    internal int LastBatchSize => _lastBatchSize;

    internal string DescribeShardProgress(int readyShards, int totalShards)
    {
        // VIOLATION: bugs/deterministic/string-format-mismatch
        // VIOLATION: bugs/deterministic/format-string-placeholder-mismatch
        // VIOLATION: bugs/deterministic/missing-format-provider-overload
        return string.Format("{0}/{1} shards ready ({2}%)", readyShards, totalShards);
    }

    internal void ReportSyncOutcome(int itemCount, string region)
    {
        // VIOLATION: bugs/deterministic/logging-args-mismatch
        _logger.LogWarning("Synced {Count} items to {Region} in {ElapsedMs} ms", itemCount, region);
    }

    internal string BuildBanner()
    {
        // VIOLATION: bugs/deterministic/fstring-missing-placeholders
        return $"telemetry flush complete";
    }

    internal string DescribeQueue(string tenant, int depth)
    {
        if (tenant.Length == 0 || depth < 0)
        {
            return string.Empty;
        }
        // VIOLATION: bugs/deterministic/missing-fstring-syntax
        return "queue depth {depth} for tenant {tenant}";
    }

    internal string LastFailureSummary()
    {
        if (_failureCount == 0)
        {
            return "healthy";
        }
        // VIOLATION: bugs/deterministic/generic-error-message
        return "Something went wrong";
    }

    internal void ValidateBatchSize(int batchSize)
    {
        if (batchSize <= 0)
        {
            // VIOLATION: bugs/deterministic/useless-exception-statement
            // VIOLATION: code-quality/deterministic/unused-constructor-result
            new ArgumentOutOfRangeException(nameof(batchSize));
        }
        _lastBatchSize = batchSize;
    }

    internal void FlushBuffer()
    {
        try
        {
            WriteSnapshot();
            TrimJournal();
        }
        // VIOLATION: bugs/deterministic/empty-catch
        catch (IOException)
        {
        }
    }

    internal void PublishHeartbeat()
    {
        try
        {
            EmitHeartbeat();
        }
        // VIOLATION: bugs/deterministic/bare-except
        catch (Exception)
        {
            _missedHeartbeats++;
            _degraded = true;
        }
    }

    internal void RecordCheckpoint()
    {
        try
        {
            PersistCheckpoint();
        }
        catch (InvalidOperationException ex)
        {
            _checkpointFailures++;
            // VIOLATION: bugs/deterministic/lost-error-context
            throw ex;
        }
    }

    internal void NormalizeFailure()
    {
        try
        {
            ReplayJournal();
        }
        catch (TimeoutException ex)
        {
            // VIOLATION: bugs/deterministic/exception-reassignment
            ex = new TimeoutException("journal replay timed out");
            _lastError = ex;
        }
    }

    internal void ExportMetrics()
    {
        try
        {
            PushToCollector();
        }
        catch (Exception)
        {
            // VIOLATION: bugs/deterministic/nested-try-catch
            try
            {
                WriteLocalFallback();
            }
            catch (InvalidOperationException fallbackError)
            {
                _lastError = fallbackError;
            }
        }
    }

    internal void CommitWindow()
    {
        try
        {
            ApplyWindow();
        }
        finally
        {
            if (!_windowApplied)
            {
                // VIOLATION: bugs/deterministic/unsafe-finally
                throw new InvalidOperationException("window commit incomplete");
            }
        }
    }

    internal void ResetJournal()
    {
        try
        {
            TruncateJournal();
        }
        // VIOLATION: bugs/deterministic/useless-finally
        finally
        {
        }
    }

    private void WriteSnapshot()
    {
        _snapshotSequence++;
    }

    private void TrimJournal()
    {
        _journalCursor--;
    }

    private void EmitHeartbeat()
    {
        _heartbeatSequence++;
    }

    private void PersistCheckpoint()
    {
        _checkpointSequence++;
    }

    private void ReplayJournal()
    {
        _journalCursor++;
    }

    private void PushToCollector()
    {
        _exportSequence++;
    }

    private void WriteLocalFallback()
    {
        _fallbackWrites++;
    }

    private void ApplyWindow()
    {
        _windowApplied = true;
    }

    private void TruncateJournal()
    {
        _journalCursor = 0;
    }
}
