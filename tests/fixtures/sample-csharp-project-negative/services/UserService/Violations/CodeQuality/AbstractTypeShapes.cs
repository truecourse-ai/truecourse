namespace UserServiceApp.Violations.CodeQuality;

// VIOLATION: code-quality/deterministic/abstract-class-public-constructor
// VIOLATION: code-quality/deterministic/csharp-filename-type-mismatch
internal abstract class LedgerEntryBase
{
    // VIOLATION: code-quality/deterministic/non-private-field
    protected readonly string Account;

    public LedgerEntryBase(string account)
    {
        Account = account;
    }

    protected abstract decimal Settle();
}

// VIOLATION: code-quality/deterministic/abstract-class-without-abstract-members
internal abstract class ReportSectionBase
{
    protected readonly string Title;

    protected ReportSectionBase(string title)
    {
        Title = title;
    }

    protected string Describe()
    {
        return Title;
    }
}
