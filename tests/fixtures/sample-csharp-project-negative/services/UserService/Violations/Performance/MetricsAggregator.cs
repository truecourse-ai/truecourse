using System.Collections.Generic;
using System.Linq;
using System.Threading;

namespace UserServiceApp.Violations.Performance;

internal sealed class MetricsAggregator
{
    private readonly List<Sample> _samples = new();
    private readonly Dictionary<string, double> _totalsByService = new();

    internal void Drain(MetricsChannel channel, CancellationToken token)
    {
        while (!token.IsCancellationRequested)
        {
            // VIOLATION: performance/deterministic/unbounded-array-growth
            _samples.Add(channel.TakeNext());
        }
    }

    internal void AccumulateSucceeded()
    {
        // VIOLATION: performance/deterministic/unnecessary-iterable-allocation
        foreach (var sample in _samples.Where(s => s.Succeeded).ToList())
        {
            _totalsByService[sample.Service] = _totalsByService.GetValueOrDefault(sample.Service) + sample.LatencyMs;
        }
    }

    internal double SumTotals()
    {
        var sum = 0.0;
        // VIOLATION: performance/deterministic/incorrect-dict-iterator
        foreach (var service in _totalsByService.Keys)
        {
            sum += _totalsByService[service];
        }
        return sum;
    }

    internal void TrackHosts(IEnumerable<string> hostNames, HashSet<string> knownHosts)
    {
        // VIOLATION: performance/deterministic/set-mutations-in-loop
        foreach (var hostName in hostNames)
        {
            knownHosts.Add(hostName);
        }
    }

    internal string BuildReport()
    {
        var report = string.Empty;
        foreach (var sample in _samples)
        {
            // VIOLATION: performance/deterministic/quadratic-list-summation
            report += $"{sample.Service}: {sample.LatencyMs}ms\n";
        }
        return report;
    }

    internal Sample Slowest()
    {
        // VIOLATION: performance/deterministic/sorted-for-min-max
        return _samples.OrderByDescending(s => s.LatencyMs).First();
    }

    internal string[] ServiceNames()
    {
        // VIOLATION: performance/deterministic/unnecessary-list-cast
        return _samples.Select(s => s.Service).Distinct().ToList().ToArray();
    }

    internal bool HasFailures()
    {
        // VIOLATION: performance/deterministic/list-comprehension-in-any-all
        return _samples.Where(s => !s.Succeeded).ToList().Any();
    }

    internal List<string> MergeTags(IEnumerable<List<string>> tagGroups)
    {
        // VIOLATION: performance/deterministic/spread-in-reduce
        return tagGroups.Aggregate(new List<string>(), (merged, batch) => merged.Concat(batch).ToList());
    }
}
