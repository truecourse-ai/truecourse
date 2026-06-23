using System.Collections.Concurrent;
using System.Collections.Generic;

namespace Positive.Boundary.Performance;

/// <summary>Caches resolved permission sets per user without per-call closures.</summary>
public sealed class ConcurrentDictionaryCapturesArgumentSafe
{
    private readonly ConcurrentDictionary<int, IReadOnlyCollection<string>> _byUser = new();

    /// <summary>Resolves (and caches) the permission set for the given user.</summary>
    internal IReadOnlyCollection<string> Resolve(int userId, IReadOnlyCollection<string> roles)
    {
        // SAFE: performance/deterministic/concurrentdictionary-captures-argument
        return _byUser.GetOrAdd(userId, static (_, state) => Expand(state), roles);
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
