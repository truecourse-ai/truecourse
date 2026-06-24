using System.Collections.Generic;

namespace Positive.Boundary.Architecture;

/// <summary>Holds roles; the public accessor returns a read-only view, not List&lt;T&gt;.</summary>
public sealed class ExposesGenericListSafe
{
    private readonly List<string> _roles = new();

    /// <summary>Return every known role name as a read-only view.</summary>
    // SAFE: architecture/deterministic/exposes-generic-list
    public IReadOnlyList<string> AllRoles() => _roles;
}
