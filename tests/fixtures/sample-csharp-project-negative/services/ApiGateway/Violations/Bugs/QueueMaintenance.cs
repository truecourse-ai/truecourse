namespace ApiGateway.Violations.Bugs;

internal class QueueMaintenance
{
    private const int ReplayBaseCost = 5;
    private const int ReplayOverheadCost = 3;
    private const int DefaultRequestQuota = 1200;
    private const int DefaultUploadQuota = 40;
    private const int BurstRequestQuota = 2400;

    private string _lastPeeked = string.Empty;
    private int _appliedVersion;
    private int _replayCount;

    internal string LastPeeked => _lastPeeked;
    internal int ReplayCount => _replayCount;

    internal int DrainBacklog(List<string> backlog)
    {
        var drained = 0;
        // VIOLATION: bugs/deterministic/for-direction
        for (var i = 0; i < backlog.Count; i--)
        {
            drained += backlog[i].Length;
        }
        return drained;
    }

    internal int EstimateWait(int remaining, int step)
    {
        var total = 0;
        // VIOLATION: bugs/deterministic/unmodified-loop-condition
        while (remaining > 0)
        {
            total += step;
        }
        return total;
    }

    internal int ScanForGap(List<int> offsets, int limit)
    {
        var gapIndex = -1;
        for (var i = 0; i < limit; i++)
        {
            if (offsets[i] != i)
            {
                gapIndex = i;
                // VIOLATION: bugs/deterministic/loop-counter-assignment
                i = limit;
            }
        }
        return gapIndex;
    }

    internal void PruneDeadLetters(List<string> deadLetters)
    {
        foreach (var letter in deadLetters)
        {
            if (letter.Length == 0)
            {
                // VIOLATION: bugs/deterministic/modified-loop-iterator
                deadLetters.Remove(letter);
            }
        }
    }

    internal int EstimateReplayCost(List<string> events)
    {
        var cost = 0;
        // VIOLATION: bugs/deterministic/unused-loop-variable
        foreach (var entry in events)
        {
            cost += ReplayBaseCost;
            cost += ReplayOverheadCost;
        }
        return cost;
    }

    internal string PeekNextJob(Queue<string> jobs)
    {
        // VIOLATION: bugs/deterministic/unreachable-loop
        while (jobs.Count > 0)
        {
            var job = jobs.Dequeue();
            RecordPeek(job);
            break;
        }
        return _lastPeeked;
    }

    internal int ApplyNextMigration(List<int> pendingVersions)
    {
        // VIOLATION: bugs/deterministic/loop-at-most-one-iteration
        foreach (var version in pendingVersions)
        {
            _appliedVersion = version;
            return version;
            // VIOLATION: bugs/deterministic/unreachable-code
            _replayCount++;
        }
        return _appliedVersion;
    }

    internal Dictionary<string, string> BuildRoutingTable(string primaryRegion, string standbyRegion)
    {
        var table = new Dictionary<string, string>();
        table["primary"] = primaryRegion;
        // VIOLATION: bugs/deterministic/element-overwrite
        table["primary"] = standbyRegion;
        return table;
    }

    internal string ResolveFallbackLocale()
    {
        // VIOLATION: bugs/deterministic/potential-index-error
        return new[] { "en-US", "fr-FR" }[2];
    }

    internal string TakeWarmupProbe()
    {
        // VIOLATION: bugs/deterministic/empty-collection-access
        var probe = new List<string>()[0];
        return probe.Trim();
    }

    internal bool IsKnownExtension(string extension)
    {
        // VIOLATION: bugs/deterministic/in-empty-collection
        return Array.Empty<string>().Contains(extension);
    }

    internal int CombineDeltas(List<int> deltas)
    {
        // VIOLATION: bugs/deterministic/reduce-missing-initial
        return deltas.Aggregate((acc, delta) => acc + delta);
    }

    internal Dictionary<string, int> DefaultQuotas()
    {
        return new Dictionary<string, int>
        {
            ["requests"] = DefaultRequestQuota,
            ["uploads"] = DefaultUploadQuota,
            // VIOLATION: bugs/deterministic/duplicate-keys
            ["requests"] = BurstRequestQuota,
        };
    }

    internal HashSet<string> AllowedFormats()
    {
        return new HashSet<string>
        {
            "json",
            "xml",
            // VIOLATION: bugs/deterministic/duplicate-set-value
            "json",
        };
    }

    internal Dictionary<string, int> IndexLengths(List<string> topics)
    {
        // VIOLATION: bugs/deterministic/static-key-dict-comprehension
        return topics.ToDictionary(topic => "topic", topic => topic.Length);
    }

    internal string CanonicalizeTopic(string topic)
    {
        // VIOLATION: bugs/deterministic/ignored-return-value
        topic.Trim();
        return topic.ToLowerInvariant();
    }

    private void RecordPeek(string job)
    {
        _lastPeeked = job;
    }
}
