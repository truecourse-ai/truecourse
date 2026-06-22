using System.Collections.Concurrent;
using System.Collections.Generic;

namespace UserServiceApp.Violations.Performance;

/// <summary>
/// Caches the resolved permission set per user. The GetOrAdd factory closes over the
/// roles argument from the enclosing scope, so a fresh closure is allocated on every
/// call; the state-parameter overload of GetOrAdd would avoid it.
/// </summary>
internal sealed class PermissionCache
{
    private readonly ConcurrentDictionary<int, IReadOnlyCollection<string>> _byUser = new();

    internal IReadOnlyCollection<string> Resolve(int userId, IReadOnlyCollection<string> roles)
    {
        // VIOLATION: performance/deterministic/concurrentdictionary-captures-argument
        return _byUser.GetOrAdd(userId, _ => Expand(roles));
    }

    private static IReadOnlyCollection<string> Expand(IReadOnlyCollection<string> roles)
    {
        var permissions = new List<string>();
        foreach (var role in roles)
        {
            permissions.Add($"role:{role}");
        }
        return permissions;
    }
}
