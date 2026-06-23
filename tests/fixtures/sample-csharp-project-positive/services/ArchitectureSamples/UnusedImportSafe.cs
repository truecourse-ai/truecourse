// SAFE: architecture/deterministic/unused-import
using Money = System.Decimal;

namespace Positive.Boundary.Architecture;

/// <summary>Sums line totals using an aliased numeric type that is actually used.</summary>
public sealed class UnusedImportSafe
{
    /// <summary>Adds two amounts through the Money alias.</summary>
    public Money Add(Money left, Money right)
    {
        return left + right;
    }
}
