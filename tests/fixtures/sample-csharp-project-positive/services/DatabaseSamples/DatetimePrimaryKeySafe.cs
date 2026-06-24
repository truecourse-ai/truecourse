using System;

namespace Positive.Boundary.Database;

/// <summary>
/// EF Core entity with a surrogate integer key. The timestamp stays an ordinary
/// column, so the temporal property is never the primary key.
/// </summary>
public sealed class DatetimePrimaryKeySafe
{
    /// <summary>Surrogate primary key.</summary>
    public long Id { get; set; }

    // SAFE: database/deterministic/datetime-primary-key
    public DateTimeOffset OccurredAt { get; set; }

    /// <summary>Account name that produced the row.</summary>
    public string UserName { get; set; } = string.Empty;
}
