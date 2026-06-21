using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// The LINQ `Any(predicate)` extension called on an array or `List&lt;T&gt;`, both
/// of which expose their own `Exists(Predicate&lt;T&gt;)` that avoids the LINQ
/// enumerator allocation. The receiver's resolved type is what distinguishes this
/// from `Any` on an arbitrary `IEnumerable`. S6605.
/// </summary>
internal sealed class PreferExists : ISemanticRule
{
    public string RuleKey => "performance/deterministic/prefer-exists";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var inv in tree.GetRoot().DescendantNodes().OfType<InvocationExpressionSyntax>())
        {
            if (inv.Expression is not MemberAccessExpressionSyntax ma) continue;
            if (ma.Name.Identifier.Text != "Any") continue;
            if (inv.ArgumentList.Arguments.Count != 1) continue; // predicate form only

            if (model.GetSymbolInfo(inv).Symbol is not IMethodSymbol m) continue;
            if (m.Name != "Any" || !m.IsExtensionMethod ||
                m.ContainingType?.Name != "Enumerable") continue;

            var recv = model.GetTypeInfo(ma.Expression).Type;
            if (recv is null) continue;
            if (recv.TypeKind != TypeKind.Array &&
                recv is not INamedTypeSymbol { Name: "List", ContainingNamespace.Name: "Generic" })
                continue;

            var pos = inv.GetLocation().GetLineSpan().StartLinePosition;
            yield return new Violation(
                RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                "Any(predicate) on an array/List allocates a LINQ enumerator — Array.Exists / List.Exists is cheaper.");
        }
    }
}
