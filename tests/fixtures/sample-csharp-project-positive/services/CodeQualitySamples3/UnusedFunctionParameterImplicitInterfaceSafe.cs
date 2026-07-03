namespace Positive.Boundary.CodeQuality;

/// <summary>Provider contract that mandates a lookup signature.</summary>
public interface ILookupProvider
{
    /// <summary>Resolves a value for the given category.</summary>
    string Get(string category);
}

/// <summary>
/// A null-object implementation whose <c>Get</c> ignores its <c>category</c> argument. The
/// parameter is contract-mandated by <see cref="ILookupProvider"/> — this is an implicit
/// interface implementation, so the parameter cannot be removed — and unused-function-parameter
/// must not fire on it (the tree-sitter variant used to, because it could not see the
/// implicit implementation; the Roslyn rule resolves it).
/// </summary>
public sealed class UnusedFunctionParameterImplicitInterfaceSafe : ILookupProvider
{
    // SAFE: code-quality/deterministic/unused-function-parameter
    /// <summary>Always returns the default value regardless of category.</summary>
    public string Get(string category) => "default";
}
