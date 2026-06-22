namespace ApiGateway.Violations.Architecture;

/// <summary>
/// The base of a domain model expressed as a deep, project-authored inheritance tree.
/// Every layer down to <see cref="EnterpriseAccount"/> is a class defined in this
/// codebase, so the concrete leaf type carries a long tail of home-grown base classes.
/// </summary>
public class PersistedEntity
{
    /// <summary>Surrogate primary key.</summary>
    public long Id { get; set; }
}

/// <summary>Adds creation/modification audit columns.</summary>
public class AuditableEntity : PersistedEntity
{
    /// <summary>Principal that created the row.</summary>
    public string CreatedBy { get; set; } = "system";
}

/// <summary>Adds soft-delete semantics on top of auditing.</summary>
public class SoftDeletableEntity : AuditableEntity
{
    /// <summary>True when the row is logically deleted.</summary>
    public bool IsDeleted { get; set; }
}
