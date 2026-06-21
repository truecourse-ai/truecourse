using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// `FirstOrDefault(predicate)` (the LINQ extension) called on an array or a
/// `List&lt;T&gt;`, both of which expose their own `Find` (Array.Find / List.Find)
/// that returns the same result without the LINQ enumerator allocation. The
/// receiver's resolved type is what separates this from `FirstOrDefault` on an
/// arbitrary `IEnumerable`, where no `Find` exists. S6602.
/// </summary>
internal sealed class PreferArrayFind : ISemanticRule
{
    public string RuleKey => "performance/deterministic/prefer-array-find";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var inv in tree.GetRoot().DescendantNodes().OfType<InvocationExpressionSyntax>())
        {
            if (inv.Expression is not MemberAccessExpressionSyntax ma) continue;
            if (ma.Name.Identifier.Text != "FirstOrDefault") continue;
            // Find takes a Predicate<T>; only the single-predicate FirstOrDefault maps.
            if (inv.ArgumentList.Arguments.Count != 1) continue;

            if (model.GetSymbolInfo(inv).Symbol is not IMethodSymbol m) continue;
            if (m.Name != "FirstOrDefault" || !m.IsExtensionMethod ||
                m.ContainingType?.Name != "Enumerable") continue;

            var recv = model.GetTypeInfo(ma.Expression).Type;
            if (recv is null) continue;
            if (recv.TypeKind != TypeKind.Array &&
                recv is not INamedTypeSymbol { Name: "List", ContainingNamespace.Name: "Generic" })
                continue;

            var pos = inv.GetLocation().GetLineSpan().StartLinePosition;
            yield return new Violation(
                RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                "FirstOrDefault(predicate) on an array/List allocates a LINQ enumerator — Array.Find / List.Find returns the same result without it.");
        }
    }
}
