namespace ApiGateway.Violations.Bugs;

internal enum PayloadKind
{
    Json,
    Xml,
    Binary,
    Unknown,
}

internal class PayloadValidator
{
    private const int MaxSegmentCount = 64;
    private const int LongRetentionDays = 365;
    private const int ShortRetentionDays = 30;

    private int _acceptedCount;
    private int _rejectedCount;
    private int _purgeRuns;

    internal int AcceptedCount => _acceptedCount;
    internal int RejectedCount => _rejectedCount;
    internal int PurgeRuns => _purgeRuns;

    internal void RecordOutcome(bool accepted)
    {
        // VIOLATION: bugs/deterministic/all-branches-identical
        // VIOLATION: code-quality/deterministic/if-with-same-arms
        if (accepted)
        {
            _acceptedCount++;
        }
        else
        {
            _acceptedCount++;
        }
    }

    internal string DescribeKind(PayloadKind kind)
    {
        var label = "unknown";
        if (kind == PayloadKind.Json)
        {
            label = "structured";
        }
        // VIOLATION: bugs/deterministic/duplicate-else-if
        else if (kind == PayloadKind.Json)
        {
            label = "tree";
        }
        return label;
    }

    internal string SummarizeRetention(int days)
    {
        var policy = "none";
        if (days > LongRetentionDays)
        {
            policy = "archive";
            _acceptedCount++;
        }
        // VIOLATION: bugs/deterministic/duplicate-branches
        else if (days > ShortRetentionDays)
        {
            policy = "archive";
            _acceptedCount++;
        }
        return policy;
    }

    internal void PurgeStaleEntries()
    {
        // VIOLATION: bugs/deterministic/constant-condition
        if (false)
        {
            _rejectedCount = 0;
        }
        _purgeRuns++;
    }

    internal string ResolveSchemaEndpoint(string primary, string fallback)
    {
        // VIOLATION: bugs/deterministic/constant-binary-expression
        var endpoint = true ? primary : fallback;
        return endpoint.Trim();
    }

    internal bool HasPendingWork()
    {
        var pending = false;
        // VIOLATION: bugs/deterministic/assignment-in-condition
        if (pending = QueueHasBacklog())
        {
            _acceptedCount++;
        }
        return pending;
    }

    internal bool IsBalanced(int openCount, int closeCount)
    {
        // VIOLATION: bugs/deterministic/self-comparison
        if (openCount == openCount)
        {
            _acceptedCount++;
            return true;
        }
        return closeCount == 0;
    }

    internal void ResetCounters()
    {
        // VIOLATION: bugs/deterministic/self-assignment
        _acceptedCount = _acceptedCount;
        _rejectedCount = 0;
    }

    internal bool ValidateSegments(string[] segments)
    {
        // VIOLATION: bugs/deterministic/collection-size-mischeck
        if (segments.Length < 0)
        {
            return false;
        }
        return segments.Length <= MaxSegmentCount;
    }

    internal string ExtractScheme(string url)
    {
        // VIOLATION: bugs/deterministic/index-of-positive-check
        if (url.IndexOf(':') > 0)
        {
            return url.Substring(0, url.IndexOf(':'));
        }
        return string.Empty;
    }

    internal bool MatchesPrefix(string route, string prefix)
    {
        if (prefix.Length == 0)
        {
            return false;
        }
        // VIOLATION: bugs/deterministic/arguments-order-mismatch
        // VIOLATION: bugs/deterministic/missing-stringcomparison-overload
        return route.StartsWith(route);
    }

    // VIOLATION: bugs/deterministic/invariant-return
    internal int MapExitCode(bool failed, bool skipped)
    {
        if (failed)
        {
            return 1;
        }
        if (skipped)
        {
            return 1;
        }
        return 1;
    }

    internal string LabelKind(PayloadKind kind)
    {
        // VIOLATION: bugs/deterministic/switch-exhaustiveness
        // VIOLATION: bugs/deterministic/switch-expression-missing-cases
        return kind switch
        {
            PayloadKind.Json => "json",
            PayloadKind.Xml => "xml",
        };
    }

    private bool QueueHasBacklog()
    {
        return _rejectedCount > 0;
    }
}
