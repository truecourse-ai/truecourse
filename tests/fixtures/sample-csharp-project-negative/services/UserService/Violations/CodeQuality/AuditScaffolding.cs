// VIOLATION: code-quality/deterministic/too-many-classes-per-file
namespace UserServiceApp.Violations.CodeQuality;

// VIOLATION: code-quality/deterministic/csharp-filename-type-mismatch
internal class AuditContext
{
    private readonly List<string> _entries = new List<string>();

    // VIOLATION: code-quality/deterministic/useless-constructor
    public AuditContext()
    {
    }

    // VIOLATION: code-quality/deterministic/accessor-pairs
    // VIOLATION: code-quality/deterministic/write-only-property
    public string Actor
    {
        set
        {
            _entries.Add(value);
        }
    }

    internal int EntryCount()
    {
        return _entries.Count;
    }
}

// VIOLATION: code-quality/deterministic/class-as-data-structure
internal class SyncCursor
{
    // VIOLATION: code-quality/deterministic/non-private-field
    public int Offset;
    public int BatchSize;
}

// VIOLATION: code-quality/deterministic/no-extraneous-class
// VIOLATION: code-quality/deterministic/static-holder-type-not-sealed
internal class MaintenanceTasks
{
    private static readonly List<string> _backlog = new List<string>();
    private static readonly List<string> _retryQueue = new List<string>();

    // VIOLATION: code-quality/deterministic/identical-functions
    internal static int CountOutstanding()
    {
        return _backlog.Count + _retryQueue.Count;
    }

    internal static int EstimateOutstanding()
    {
        return _backlog.Count + _retryQueue.Count;
    }
}

internal class RateAuditor
{
    private int _auditCount;

    // VIOLATION: code-quality/deterministic/empty-static-block
    static RateAuditor()
    {
    }

    // VIOLATION: code-quality/deterministic/empty-function
    // VIOLATION: code-quality/deterministic/no-empty-function
    internal void WarmCaches()
    {
    }

    internal decimal AuditFee(decimal fee)
    {
        _auditCount++;
        return RoundFee(fee);
    }

    internal int AuditedSoFar()
    {
        return _auditCount;
    }

    // VIOLATION: code-quality/deterministic/static-method-candidate
    // VIOLATION: code-quality/deterministic/unused-this-parameter
    private decimal RoundFee(decimal fee)
    {
        return Math.Round(fee, 2);
    }
}
