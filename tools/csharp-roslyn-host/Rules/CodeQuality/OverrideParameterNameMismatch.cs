using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// An `override` (or interface implementation) whose parameter names differ from the
/// base declaration. Named-argument calls bind to the parameter names of the static
/// type, so a renamed override silently breaks `base.Method(x: ...)` callers and
/// confuses readers comparing the two. We resolve the overridden/implemented method
/// and compare parameter names position-by-position. CA1725.
/// </summary>
internal sealed class OverrideParameterNameMismatch : ISemanticRule
{
    public string RuleKey => "code-quality/deterministic/override-parameter-name-mismatch";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var method in tree.GetRoot().DescendantNodes().OfType<MethodDeclarationSyntax>())
        {
            if (model.GetDeclaredSymbol(method) is not IMethodSymbol sym) continue;

            var baseMethod = ResolveBase(sym);
            if (baseMethod is null) continue;
            if (baseMethod.Parameters.Length != sym.Parameters.Length) continue;

            for (var i = 0; i < sym.Parameters.Length; i++)
            {
                var derived = sym.Parameters[i];
                var basis = baseMethod.Parameters[i];
                if (derived.Name == basis.Name) continue;
                // The base parameter may itself be unnamed (e.g. from metadata) — only
                // flag when both have real names that genuinely differ.
                if (string.IsNullOrEmpty(basis.Name)) continue;

                var paramSyntax = method.ParameterList.Parameters[i];
                var pos = paramSyntax.Identifier.GetLocation().GetLineSpan().StartLinePosition;
                yield return new Violation(
                    RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                    $"Parameter '{derived.Name}' differs from the base declaration's '{basis.Name}'; matching names keep named-argument calls working.");
            }
        }
    }

    private static IMethodSymbol? ResolveBase(IMethodSymbol method)
    {
        if (method.IsOverride && method.OverriddenMethod is { } overridden)
            return overridden;

        // Single, unambiguous interface implementation (explicit or implicit).
        if (method.ExplicitInterfaceImplementations.Length == 1)
            return method.ExplicitInterfaceImplementations[0];

        var type = method.ContainingType;
        if (type is null) return null;
        IMethodSymbol? impl = null;
        foreach (var iface in type.AllInterfaces)
            foreach (var member in iface.GetMembers(method.Name).OfType<IMethodSymbol>())
                if (SymbolEqualityComparer.Default.Equals(type.FindImplementationForInterfaceMember(member), method))
                {
                    if (impl is not null) return null; // implements >1 interface member — ambiguous, skip
                    impl = member;
                }
        return impl;
    }
}
