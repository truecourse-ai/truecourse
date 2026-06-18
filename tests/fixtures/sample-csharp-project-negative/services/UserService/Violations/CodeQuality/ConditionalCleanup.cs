namespace UserServiceApp.Violations.CodeQuality;

internal class BillingPlan
{
    public bool IsAnnual { get; set; }
    public bool IsTrial { get; set; }
    public bool IsBusiness { get; set; }
    public decimal BusinessRate { get; set; }
    public decimal PersonalRate { get; set; }
}

internal class ConditionalCleanup
{
    internal void StartCheckoutIfReady(BillingPlan plan, bool hasItems, bool isActive)
    {
        // VIOLATION: code-quality/deterministic/collapsible-if
        if (hasItems)
        {
            if (isActive)
            {
                BeginCheckout(plan);
            }
        }
    }

    internal void ApplyRates(BillingPlan plan)
    {
        if (plan.IsAnnual)
        {
            ApplyAnnualRate(plan);
        }
        // VIOLATION: code-quality/deterministic/collapsible-else-if
        // VIOLATION: code-quality/deterministic/no-lonely-if
        else
        {
            if (plan.IsTrial)
            {
                ApplyTrialRate(plan);
            }
        }
    }

    internal decimal SelectRate(BillingPlan plan)
    {
        decimal rate;
        // VIOLATION: code-quality/deterministic/if-else-instead-of-ternary
        if (plan.IsBusiness)
        {
            rate = plan.BusinessRate;
        }
        else
        {
            rate = plan.PersonalRate;
        }
        return rate;
    }

    internal decimal CapRequest(decimal dailyCap, decimal requested)
    {
        // VIOLATION: code-quality/deterministic/if-expr-min-max
        var cap = dailyCap > requested ? dailyCap : requested;
        return cap - requested;
    }

    internal void ArchiveInvoice(string invoiceId, bool isArchived, List<string> queue)
    {
        // VIOLATION: code-quality/deterministic/if-with-same-arms
        // VIOLATION: bugs/deterministic/all-branches-identical
        if (isArchived)
        {
            queue.Add(invoiceId);
        }
        else
        {
            queue.Add(invoiceId);
        }
    }

    internal void RefreshSnapshot(BillingPlan plan, bool isReady)
    {
        // VIOLATION: code-quality/deterministic/negated-condition
        if (!isReady)
        {
            ScheduleRefresh(plan);
        }
        else
        {
            var rate = SelectRate(plan);
            var label = DescribeRate(rate);
            PublishRate(label);
        }
    }

    internal string DescribeBalance(decimal balance)
    {
        // VIOLATION: code-quality/deterministic/unnecessary-else-after-return
        if (balance < 0)
        {
            return "overdrawn";
        }
        else
        {
            return DescribeRate(balance);
        }
    }

    internal void CleanRows(List<string> rows, List<string> cleaned)
    {
        foreach (var row in rows)
        {
            if (row.Length == 0)
            {
                continue;
            }
            // VIOLATION: code-quality/deterministic/superfluous-else-after-control
            else
            {
                cleaned.Add(row);
            }
        }
    }

    // VIOLATION: code-quality/deterministic/prefer-single-boolean-return
    internal bool CanArchive(BillingPlan plan, int pendingReviews)
    {
        if (plan.IsTrial)
        {
            return false;
        }
        if (pendingReviews > 0)
        {
            return false;
        }
        return true;
    }

    internal bool CanShip(bool isPacked)
    {
        // VIOLATION: code-quality/deterministic/inverted-boolean
        var canShip = !(!isPacked);
        PublishRate(canShip ? "packed" : "waiting");
        return canShip;
    }

    internal bool RequiresAudit(BillingPlan plan)
    {
        // VIOLATION: code-quality/deterministic/double-negation
        var requiresAudit = !!plan.IsBusiness;
        PublishRate(requiresAudit ? "audited" : "waived");
        return requiresAudit;
    }

    internal void BeginCheckout(BillingPlan plan)
    {
        PublishRate(plan.IsAnnual ? "annual" : "monthly");
    }

    internal void ApplyAnnualRate(BillingPlan plan)
    {
        plan.BusinessRate = plan.BusinessRate - 1m;
    }

    internal void ApplyTrialRate(BillingPlan plan)
    {
        plan.PersonalRate = 0m;
    }

    internal void ScheduleRefresh(BillingPlan plan)
    {
        plan.IsTrial = false;
    }

    internal string DescribeRate(decimal rate)
    {
        return $"rate {rate}";
    }

    internal void PublishRate(string label)
    {
        _publishedLabels.Add(label);
    }

    private readonly List<string> _publishedLabels = new List<string>();
}
