using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// A MEF <c>[Export(typeof(I))]</c> whose type does not implement or derive from the
/// exported contract <c>I</c> (S4159). The container advertises the type under contract
/// <c>I</c>, but an importer of <c>I</c> receives an instance that cannot be cast to it —
/// composition throws at runtime. Resolved with the semantic model so transitive and
/// base-type implementations count; kept false-positive free by skipping any type whose
/// base/interface hierarchy is not fully resolved (so a contract satisfied through an
/// unseen base is never misreported).
/// </summary>
internal sealed class ExportInterfaceNotImplemented : ISemanticRule
{
    public string RuleKey => "bugs/deterministic/export-interface-not-implemented";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var type in tree.GetRoot().DescendantNodes().OfType<TypeDeclarationSyntax>())
        {
            if (type is not (ClassDeclarationSyntax or StructDeclarationSyntax)) continue;
            if (model.GetDeclaredSymbol(type) is not INamedTypeSymbol cls) continue;
            if (!HierarchyFullyResolved(cls)) continue;

            foreach (var attr in type.AttributeLists.SelectMany(l => l.Attributes))
            {
                var name = AttrSimpleName(attr);
                if (name != "Export" && name != "InheritedExport") continue;
                if (attr.ArgumentList is null) continue;

                foreach (var arg in attr.ArgumentList.Arguments)
                {
                    if (arg.Expression is not TypeOfExpressionSyntax typeOf) continue;
                    var contract = model.GetTypeInfo(typeOf.Type).Type;
                    if (contract is null || contract.TypeKind == TypeKind.Error) continue;
                    if (SymbolEqualityComparer.Default.Equals(contract, cls)) continue;
                    if (Implements(cls, contract)) continue;

                    var pos = typeOf.GetLocation().GetLineSpan().StartLinePosition;
                    yield return new Violation(
                        RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                        $"'{cls.Name}' is exported as '{contract.Name}' but does not implement or derive from it, so MEF composition fails when '{contract.Name}' is imported.");
                }
            }
        }
    }

    private static bool Implements(INamedTypeSymbol cls, ITypeSymbol contract)
    {
        if (contract.TypeKind == TypeKind.Interface)
            return cls.AllInterfaces.Any(i => SymbolEqualityComparer.Default.Equals(i, contract));
        for (var b = cls.BaseType; b is not null; b = b.BaseType)
            if (SymbolEqualityComparer.Default.Equals(b, contract)) return true;
        return false;
    }

    // True when every base type and interface in the hierarchy resolved — so AllInterfaces
    // is complete and an "unimplemented" verdict is trustworthy.
    private static bool HierarchyFullyResolved(INamedTypeSymbol cls)
    {
        if (cls.AllInterfaces.Any(i => i.TypeKind == TypeKind.Error)) return false;
        for (var b = cls.BaseType; b is not null; b = b.BaseType)
            if (b.TypeKind == TypeKind.Error) return false;
        return true;
    }

    private static string AttrSimpleName(AttributeSyntax attr)
    {
        var name = attr.Name.ToString();
        var simple = name.Contains('.') ? name[(name.LastIndexOf('.') + 1)..] : name;
        return simple.EndsWith("Attribute") ? simple[..^"Attribute".Length] : simple;
    }
}
