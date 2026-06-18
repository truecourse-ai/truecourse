namespace ApiGateway.Violations.Bugs;

internal class ProbeResult
{
    internal string Target { get; set; } = string.Empty;
    internal int LatencyMs { get; set; }
}

internal class DiagnosticsProbe
{
    private int _selfTestRuns;
    private string _lastTarget = string.Empty;

    internal string LastTarget => _lastTarget;
    internal int SelfTestRuns => _selfTestRuns;

    // VIOLATION: bugs/deterministic/infinite-recursion
    internal string RegionCode => RegionCode;

    internal string DescribeLastProbe()
    {
        var result = new ProbeResult();
        // VIOLATION: bugs/deterministic/base-to-string
        return $"last probe: {result}";
    }

    internal bool IsDefaultProbe(ProbeResult candidate)
    {
        // VIOLATION: bugs/deterministic/new-object-identity-check
        return ReferenceEquals(candidate, new ProbeResult());
    }

    internal bool RequiresDeepScan(object payload)
    {
        // VIOLATION: bugs/deterministic/type-comparison-instead-of-isinstance
        return payload.GetType() == typeof(ProbeResult);
    }

    internal void RunSelfTest()
    {
        // VIOLATION: bugs/deterministic/assert-raises-too-broad
        Assert.Throws(typeof(Exception), () => ParseProbeTarget(string.Empty));
        _selfTestRuns++;
    }

    private string ParseProbeTarget(string target)
    {
        if (target.Length == 0)
        {
            throw new ArgumentException("probe target is required", nameof(target));
        }
        _lastTarget = target;
        return target;
    }
}
