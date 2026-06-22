namespace UserServiceApp.Violations.CodeQuality;

// VIOLATION: code-quality/deterministic/error-instead-of-exception
internal class StaleSnapshotError : Exception
{
    public StaleSnapshotError(string message) : base(message)
    {
    }
}

internal class PriceTier
{
    public string Code { get; set; } = "";

    // VIOLATION: code-quality/deterministic/eq-without-hash
    public override bool Equals(object obj)
    {
        return obj is PriceTier tier && tier.Code == Code;
    }
}

internal class ExceptionShapes
{
    private readonly List<string> _failures = new List<string>();

    internal void GuardLedgerBalance(decimal debits, decimal credits)
    {
        if (debits < credits)
        {
            // VIOLATION: code-quality/deterministic/broad-exception-raised
            // VIOLATION: bugs/deterministic/raise-reserved-exception-type
            throw new Exception("Refund ledger is out of balance for the current period");
        }
    }

    internal void ImportLedger(List<string> rows)
    {
        try
        {
            if (rows.Count == 0)
            {
                // VIOLATION: code-quality/deterministic/raise-within-try
                throw new InvalidOperationException("Ledger import received no rows");
            }
            ApplyRows(rows);
        }
        catch (Exception ex)
        {
            _failures.Add(ex.Message);
        }
    }

    internal int ParseManifest(string raw)
    {
        try
        {
            return DecodeManifest(raw);
        }
        // VIOLATION: code-quality/deterministic/useless-catch
        // VIOLATION: code-quality/deterministic/no-useless-catch
        // VIOLATION: reliability/deterministic/catch-rethrow-no-context
        catch (FormatException)
        {
            throw;
        }
    }

    internal void ApplyRows(List<string> rows)
    {
        foreach (var row in rows)
        {
            _failures.Remove(row);
        }
    }

    internal int DecodeManifest(string raw)
    {
        return raw.Length;
    }
}
