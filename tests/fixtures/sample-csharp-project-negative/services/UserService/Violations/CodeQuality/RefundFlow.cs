namespace UserServiceApp.Violations.CodeQuality;

internal class RefundLine
{
    public string Id { get; set; } = "";
    public decimal Amount { get; set; }
}

internal class RefundFlow
{
    private int _cursor;

    internal decimal ApplyCredit(decimal balance, decimal credit, string traceId)
    {
        // VIOLATION: code-quality/deterministic/unused-function-parameter
        return balance - credit;
    }

    internal decimal NormalizeAmount(decimal amount)
    {
        // VIOLATION: code-quality/deterministic/parameter-reassignment
        amount = Math.Round(amount, 2);
        return amount;
    }

    internal string ResolveStatus(RefundLine line)
    {
        // VIOLATION: code-quality/deterministic/dead-store
        var status = "pending";
        status = LookupStatus(line);
        return status;
    }

    internal int CountRefunds(List<RefundLine> refunds)
    {
        // VIOLATION: code-quality/deterministic/unused-variable
        var retryWindow = refunds.Capacity;
        return refunds.Count;
    }

    internal void ValidateRefunds(List<RefundLine> refunds)
    {
        // VIOLATION: code-quality/deterministic/unused-collection
        var rejected = new List<string>();
        foreach (var refund in refunds)
        {
            if (refund.Amount < 0)
            {
                rejected.Add(refund.Id);
            }
        }
    }

    internal void BeginAudit(string operationName)
    {
        // VIOLATION: code-quality/deterministic/unused-constructor-result
        new LegacyAuditScope(operationName);
    }

    internal string FormatReceipt(RefundLine line)
    {
        // VIOLATION: code-quality/deterministic/prefer-immediate-return
        var receipt = $"refund {line.Id} for {line.Amount}";
        return receipt;
    }

    internal decimal SplitTotals(RefundLine line)
    {
        decimal gross;
        decimal net;
        // VIOLATION: code-quality/deterministic/multi-assign
        gross = net = line.Amount;
        return gross + net;
    }

    internal int AdvancePage(int requestedPage)
    {
        var pageIndex = requestedPage;
        // VIOLATION: code-quality/deterministic/non-augmented-assignment
        pageIndex = pageIndex + 1;
        return pageIndex;
    }

    internal int NextSequence()
    {
        // VIOLATION: code-quality/deterministic/no-return-assign
        return _cursor = ComputeNextCursor();
    }

    internal int CurrentSequence()
    {
        return _cursor;
    }

    private string LookupStatus(RefundLine line)
    {
        return _cursor > line.Amount ? "settled" : "queued";
    }

    private int ComputeNextCursor()
    {
        return _cursor + 1;
    }
}
