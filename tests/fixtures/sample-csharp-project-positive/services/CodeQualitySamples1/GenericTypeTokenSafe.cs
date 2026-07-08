using System;
using System.Collections.Generic;

namespace Positive.Boundary.CodeQuality;

/// <summary>
/// Type-token / DI-style generic APIs where the caller specifying the type
/// argument is the intended design (like <c>GetService&lt;T&gt;()</c>). The type
/// parameter is used only in the method body, never produced in the return type,
/// so generic-parameter-not-inferable must not fire.
/// </summary>
public static class GenericTypeTokenSafe
{
    // SAFE: code-quality/deterministic/generic-parameter-not-inferable
    /// <summary>Feature toggle keyed by type; caller specifies T by design.</summary>
    public static void Enable<TFeature>()
    {
        Registry.Add(typeof(TFeature));
    }

    // SAFE: code-quality/deterministic/generic-parameter-not-inferable
    /// <summary>DI-style registration; caller specifies the context type.</summary>
    public static void AddContext<TContext>()
    {
        Registry.Add(typeof(TContext));
    }

    private static readonly List<Type> Registry = new List<Type>();
}

/// <summary>
/// An interface whose generic method's signature is the contract itself (mirrors
/// EF Core's <c>Set&lt;TEntity&gt;</c>). Non-inferable there is by design, so the
/// rule must not fire on an interface member.
/// </summary>
public interface IEntitySetSafe
{
    // SAFE: code-quality/deterministic/generic-parameter-not-inferable
    IReadOnlyList<TEntity> Set<TEntity>(string name);
}
