#nullable enable
namespace Positive.Boundary.CodeQuality;

/// <summary>
/// Two <c>#nullable</c> directives where the second genuinely changes the
/// context (enable then disable). Because each directive alters the effective
/// state, neither restates what is already in effect and the rule must not fire.
/// </summary>
public sealed class RedundantNullableDirectiveSafe
{
    /// <summary>An optional display name for the entry.</summary>
    public string? Name { get; }

    /// <summary>Creates an entry with an optional display name.</summary>
    public RedundantNullableDirectiveSafe(string? name)
    {
        Name = name;
    }
}

// SAFE: code-quality/deterministic/redundant-nullable-directive
#nullable disable
