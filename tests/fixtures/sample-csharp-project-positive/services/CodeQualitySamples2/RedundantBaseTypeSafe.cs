namespace Positive.Boundary.CodeQuality;

/// <summary>The contract a ledger entry implements.</summary>
internal interface ILedgerEntry
{
    /// <summary>The settled amount of the entry.</summary>
    decimal Amount { get; }
}

/// <summary>
/// A type whose base list names only a real interface — no explicit
/// <c>object</c> — so the rule (which flags <c>object</c> in a base list)
/// must not fire.
/// </summary>
// SAFE: code-quality/deterministic/redundant-base-type
public sealed class RedundantBaseTypeSafe : ILedgerEntry
{
    /// <summary>The settled amount of the entry.</summary>
    public decimal Amount { get; }

    /// <summary>Creates an entry with the given settled amount.</summary>
    public RedundantBaseTypeSafe(decimal amount)
    {
        Amount = amount;
    }
}
