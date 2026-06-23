namespace UserServiceApp.Violations.Bugs;

/// <summary>
/// Account lifecycle states persisted to the database as integers. The values were
/// only half-assigned — some pinned, others left to positional defaults — so
/// inserting a member silently renumbers the rest under existing rows.
/// </summary>
// VIOLATION: bugs/deterministic/enum-implicit-values
internal enum AccountStatus
{
    Pending = 1,
    Active,
    Suspended = 5,
    Closed,
}
