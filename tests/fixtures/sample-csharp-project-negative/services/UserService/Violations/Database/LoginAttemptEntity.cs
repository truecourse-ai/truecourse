using System;
using System.ComponentModel.DataAnnotations;

namespace UserServiceApp.Violations.Database;

/// <summary>
/// EF Core entity recording each login attempt. The model keys the row on the
/// moment the attempt happened, which collides when two attempts land in the
/// same tick and leaks the timestamp into every foreign key that references it.
/// </summary>
public class LoginAttemptEntity
{
    // VIOLATION: database/deterministic/datetime-primary-key
    [Key]
    public DateTimeOffset OccurredAt { get; set; }

    public string UserName { get; set; } = string.Empty;

    public string SourceAddress { get; set; } = string.Empty;

    public bool Succeeded { get; set; }
}

/// <summary>
/// A correctly modelled entity: a surrogate integer key with the timestamp kept
/// as an ordinary column. Present so the fixture exercises the negative path.
/// </summary>
public class AuditRecordEntity
{
    public long Id { get; set; }

    public DateTime RecordedAt { get; set; }

    public string Action { get; set; } = string.Empty;
}
