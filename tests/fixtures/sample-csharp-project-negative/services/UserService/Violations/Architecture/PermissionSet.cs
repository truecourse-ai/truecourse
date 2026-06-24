using System.Collections;

namespace UserServiceApp.Violations.Architecture;

// VIOLATION: architecture/deterministic/collection-missing-generic-interface
internal sealed class PermissionSet : IEnumerable
{
    private readonly ArrayList _permissions = new();

    internal void Add(string permission) => _permissions.Add(permission);

    /// <summary>Iterate the granted permissions.</summary>
    public IEnumerator GetEnumerator() => _permissions.GetEnumerator();
}
