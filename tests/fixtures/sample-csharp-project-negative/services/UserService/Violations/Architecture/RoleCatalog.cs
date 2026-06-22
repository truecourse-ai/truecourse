using System.Collections.Generic;

namespace UserServiceApp.Violations.Architecture;

/// <summary>The set of roles known to the service.</summary>
public sealed class RoleCatalog
{
    private readonly List<string> _roles = new();

    /// <summary>Return every known role name.</summary>
    // VIOLATION: architecture/deterministic/exposes-generic-list
    public List<string> AllRoles() => _roles;
}
