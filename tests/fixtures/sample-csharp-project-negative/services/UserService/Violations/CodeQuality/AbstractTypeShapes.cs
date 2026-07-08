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

// An abstract class with no reason to be abstract: no abstract members, no
// virtual/override member (no extension point), no protected constructor, and no
// base type. It should simply be a concrete class.
// VIOLATION: code-quality/deterministic/abstract-class-without-abstract-members
internal abstract class ReportSectionBase
{
    private int _renders;

    internal int Render()
    {
        _renders++;
        return _renders;
    }
}
