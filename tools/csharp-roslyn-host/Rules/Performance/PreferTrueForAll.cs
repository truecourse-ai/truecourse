using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// The LINQ `All(predicate)` extension called on an array or `List&lt;T&gt;`, both
/// of which expose their own `TrueForAll(Predicate&lt;T&gt;)` that avoids the LINQ
/// enumerator allocation. Receiver type resolution distinguishes this from `All`
/// on an arbitrary `IEnumerable`. S6603.
/// </summary>
internal sealed class PreferTrueForAll : ISemanticRule
{
    public string RuleKey => "performance/deterministic/prefer-trueforall";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var inv in tree.GetRoot().DescendantNodes().OfType<InvocationExpressionSyntax>())
        {
            if (inv.Expression is not MemberAccessExpressionSyntax ma) continue;
            if (ma.Name.Identifier.Text != "All") continue;
            if (inv.ArgumentList.Arguments.Count != 1) continue;

            if (model.GetSymbolInfo(inv).Symbol is not IMethodSymbol m) continue;
            if (m.Name != "All" || !m.IsExtensionMethod ||
                m.ContainingType?.Name != "Enumerable") continue;

            var recv = model.GetTypeInfo(ma.Expression).Type;
            if (recv is null) continue;
            if (recv.TypeKind != TypeKind.Array &&
                recv is not INamedTypeSymbol { Name: "List", ContainingNamespace.Name: "Generic" })
                continue;

            var pos = inv.GetLocation().GetLineSpan().StartLinePosition;
            yield return new Violation(
                RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                "All(predicate) on an array/List allocates a LINQ enumerator — Array.TrueForAll / List.TrueForAll is cheaper.");
        }
    }
}
