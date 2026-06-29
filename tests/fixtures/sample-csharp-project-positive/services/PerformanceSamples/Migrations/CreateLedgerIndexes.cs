using System;

namespace Positive.Boundary.Performance.Migrations;

/// <summary>
/// A scaffolded schema migration. Files under a `Migrations/` directory are
/// regenerated wholesale by tooling and run once, so the constant column array
/// below must not be hoisted into a static field — any such edit would be
/// overwritten on the next regeneration.
/// </summary>
public sealed class CreateLedgerIndexes
{
    /// <summary>Returns the ordinal of the supplied column in the seeded index.</summary>
    public int ColumnOrdinal(string column)
    {
        // SAFE: performance/deterministic/constant-array-argument
        return Array.IndexOf(new[] { "Account", "Posted", "Amount" }, column);
    }
}
