namespace UserServiceApp.Violations.CodeQuality;

internal class CustomerProfile
{
    public string MiddleName { get; set; } = "";
    public CustomerAddress? Address { get; set; }
}

internal class CustomerAddress
{
    public string City { get; set; } = "";
}

internal class GuardExpressions
{
    private readonly List<string> _auditTrail = new List<string>();

    internal void GateUrgentRequest(bool isUrgent)
    {
        // VIOLATION: code-quality/deterministic/contradictory-boolean-expression
        if (isUrgent && !isUrgent)
        {
            _auditTrail.Add("urgent gate entered");
        }
    }

    internal void GateOrderRelease(bool hasItems, bool isVerified, bool isEmbargoed, bool isApproved)
    {
        // VIOLATION: code-quality/deterministic/too-many-boolean-expressions
        if (hasItems && isVerified && !isEmbargoed && isApproved)
        {
            _auditTrail.Add("release approved");
        }
    }

    internal void GateRetryWindow(int retries, int failures)
    {
        // VIOLATION: code-quality/deterministic/bitwise-in-boolean
        if ((retries == 0) & (failures == 0))
        {
            _auditTrail.Add("retry window clean");
        }
    }

    internal void GatePendingJobs(int pendingJobs)
    {
        // VIOLATION: code-quality/deterministic/yoda-condition
        if (0 == pendingJobs)
        {
            _auditTrail.Add("queue drained");
        }
    }

    internal bool HasBacklog(int queueDepth)
    {
        // VIOLATION: code-quality/deterministic/trivial-ternary
        var hasBacklog = queueDepth > 0 ? true : false;
        _auditTrail.Add(hasBacklog ? "backlog present" : "backlog clear");
        return hasBacklog;
    }

    internal string ResolveTier(int score, int threshold, int floor)
    {
        // VIOLATION: code-quality/deterministic/nested-ternary
        var tier = score > threshold ? "gold" : score > floor ? "silver" : "bronze";
        return tier + " tier";
    }

    internal void ApplyLegacyRounding()
    {
        // VIOLATION: code-quality/deterministic/comparison-of-constant
        // VIOLATION: bugs/deterministic/constant-binary-expression
        if (2 > 1)
        {
            _auditTrail.Add("legacy rounding applied");
        }
    }

    internal void GateMiddleName(CustomerProfile customer)
    {
        // VIOLATION: code-quality/deterministic/compare-to-empty-string
        if (customer.MiddleName != "")
        {
            _auditTrail.Add("middle name present");
        }
    }

    internal void GateAddress(CustomerProfile profile)
    {
        // VIOLATION: code-quality/deterministic/prefer-optional-chain
        if (profile != null && profile.Address != null)
        {
            _auditTrail.Add("address on file");
        }
    }

    internal void GateRegion(List<string> allowedRegions, string region)
    {
        // VIOLATION: code-quality/deterministic/prefer-includes
        if (allowedRegions.IndexOf(region) >= 0)
        {
            _auditTrail.Add("region allowed");
        }
    }

    internal void GateLegacySku(string sku)
    {
        // VIOLATION: code-quality/deterministic/substring-over-starts-ends
        if (sku.IndexOf("LEGACY") == 0)
        {
            _auditTrail.Add("legacy sku detected");
        }
    }

    internal void GateWarnings(IEnumerable<string> warnings)
    {
        // VIOLATION: code-quality/deterministic/len-test
        if (warnings.Count() == 0)
        {
            _auditTrail.Add("no warnings raised");
        }
    }

    internal decimal BlendRiskScore(decimal baseRisk, decimal ageFactor, decimal regionFactor, decimal historyFactor)
    {
        var ageWeight = baseRisk - ageFactor;
        var regionWeight = baseRisk - regionFactor;
        var historyWeight = baseRisk - historyFactor;
        // VIOLATION: code-quality/deterministic/expression-complexity
        // VIOLATION: code-quality/deterministic/arithmetic-precedence-parentheses
        var riskScore = baseRisk + ageFactor * ageWeight + regionFactor * regionWeight + historyFactor * historyWeight;
        return Math.Max(riskScore, baseRisk);
    }

    internal void RequireOrder(object order)
    {
        // VIOLATION: code-quality/deterministic/use-argumentnullexception-throwhelper
        if (order == null) throw new ArgumentNullException(nameof(order));
        _auditTrail.Add("order present");
    }

    internal void RequireOpen(bool disposed)
    {
        // VIOLATION: code-quality/deterministic/use-objectdisposedexception-throwhelper
        if (disposed) throw new ObjectDisposedException(nameof(GuardExpressions));
        _auditTrail.Add("still open");
    }

    internal bool IsTagBlank(string tag)
    {
        _auditTrail.Add("tag check");
        // VIOLATION: code-quality/deterministic/use-isnullorempty
        return tag == null || tag.Length == 0;
    }

    internal void ReplayUnlessMatched(Action work, int expected)
    {
        _auditTrail.Add("replay attempt");
        try
        {
            work();
        }
        catch (InvalidOperationException ex)
        {
            // VIOLATION: code-quality/deterministic/use-exception-filter
            if (ex.HResult != expected) throw;
            _auditTrail.Add("matched and recovered");
        }
    }

    internal void MarkReady(int depth)
    {
        // VIOLATION: code-quality/deterministic/if-to-boolean-assignment
        // VIOLATION: code-quality/deterministic/if-else-instead-of-ternary
        if (depth > 0)
        {
            _ready = true;
        }
        else
        {
            _ready = false;
        }
        _auditTrail.Add(_ready ? "ready" : "idle");
    }

    private bool _ready;

    internal bool MaskClear(int flags, int mask)
    {
        _auditTrail.Add("mask check");
        // VIOLATION: code-quality/deterministic/add-clarifying-parentheses
        return (flags & mask == 0);
    }
}
