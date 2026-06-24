using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// A method parameter typed as a concrete collection (List&lt;T&gt;, HashSet&lt;T&gt;, …)
/// that the body only ever iterates with <c>foreach</c> (S3242). Since nothing but
/// enumeration is done, <c>IEnumerable&lt;T&gt;</c> accepts the same arguments and more,
/// so the concrete type needlessly narrows the API. Kept false-positive free: flagged
/// only when EVERY reference to the parameter is the collection expression of a
/// <c>foreach</c>, and never on a signature the author cannot change
/// (override/virtual/abstract, or an interface implementation) — broadening those would
/// break the contract.
/// </summary>
internal sealed class ParameterNarrowerThanNeeded : ISemanticRule
{
    public string RuleKey => "code-quality/deterministic/parameter-narrower-than-needed";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var method in tree.GetRoot().DescendantNodes().OfType<MethodDeclarationSyntax>())
        {
            if (method.Body is null && method.ExpressionBody is null) continue;
            if (model.GetDeclaredSymbol(method) is not IMethodSymbol ms) continue;
            if (IsContractBound(ms)) continue;

            foreach (var p in method.ParameterList.Parameters)
            {
                if (model.GetDeclaredSymbol(p) is not IParameterSymbol sym) continue;
                if (!IsConcreteEnumerable(sym.Type, out var elementType)) continue;

                var refs = method.DescendantNodes()
                    .OfType<IdentifierNameSyntax>()
                    .Where(id => id.Identifier.ValueText == sym.Name &&
                                 SymbolEqualityComparer.Default.Equals(model.GetSymbolInfo(id).Symbol, sym))
                    .ToList();
                if (refs.Count == 0 || !refs.All(IsForeachCollection)) continue;

                var pos = p.Identifier.GetLocation().GetLineSpan().StartLinePosition;
                yield return new Violation(
                    RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                    $"Parameter '{sym.Name}' is only iterated; declare it as IEnumerable<{elementType}> so callers aren't forced to a concrete {sym.Type.Name}.");
            }
        }
    }

    // The method's signature is fixed by a base or interface contract, so the parameter
    // type cannot be widened without breaking it.
    private static bool IsContractBound(IMethodSymbol ms)
    {
        if (ms.IsOverride || ms.IsVirtual || ms.IsAbstract) return true;
        if (ms.ExplicitInterfaceImplementations.Length > 0) return true;
        if (ms.ContainingType is null) return false;
        foreach (var iface in ms.ContainingType.AllInterfaces)
            foreach (var member in iface.GetMembers().OfType<IMethodSymbol>())
                if (SymbolEqualityComparer.Default.Equals(ms.ContainingType.FindImplementationForInterfaceMember(member), ms))
                    return true;
        return false;
    }

    // A concrete (non-interface) class implementing exactly one IEnumerable<T>, whose
    // element type T is what an IEnumerable<T> replacement would carry. Interfaces are
    // skipped (already abstract) as are non-generic enumerables (IEnumerable<T> unknown).
    private static bool IsConcreteEnumerable(ITypeSymbol type, out string elementType)
    {
        elementType = string.Empty;
        if (type.TypeKind == TypeKind.Interface) return false;
        if (type is not INamedTypeSymbol named) return false;

        var enumerables = named.AllInterfaces
            .Where(i => i.OriginalDefinition.SpecialType == SpecialType.System_Collections_Generic_IEnumerable_T)
            .ToList();
        if (enumerables.Count != 1) return false;

        elementType = enumerables[0].TypeArguments[0].ToDisplayString();
        return true;
    }

    private static bool IsForeachCollection(IdentifierNameSyntax id) =>
        id.Parent is ForEachStatementSyntax fe && fe.Expression == id;
}
