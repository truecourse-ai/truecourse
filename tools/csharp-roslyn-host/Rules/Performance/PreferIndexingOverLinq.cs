using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// The argument-less LINQ `First()` / `Last()` or `ElementAt(i)` extension called
/// on an indexable receiver (an array or a type implementing `IList&lt;T&gt;`),
/// where direct indexing — `xs[0]`, `xs[^1]`, `xs[i]` — avoids enumeration. The
/// receiver's resolved type is what proves indexing is available.
/// </summary>
internal sealed class PreferIndexingOverLinq : ISemanticRule
{
    public string RuleKey => "performance/deterministic/prefer-indexing-over-linq";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var inv in tree.GetRoot().DescendantNodes().OfType<InvocationExpressionSyntax>())
        {
            if (inv.Expression is not MemberAccessExpressionSyntax ma) continue;
            var name = ma.Name.Identifier.Text;
            var argc = inv.ArgumentList.Arguments.Count;
            // First()/Last() take no args; ElementAt(i) takes the index.
            var isTarget = (name is "First" or "Last" && argc == 0) ||
                           (name == "ElementAt" && argc == 1);
            if (!isTarget) continue;

            if (model.GetSymbolInfo(inv).Symbol is not IMethodSymbol m) continue;
            if (!m.IsExtensionMethod || m.ContainingType?.Name != "Enumerable") continue;

            var recv = model.GetTypeInfo(ma.Expression).Type;
            if (recv is null || !IsIndexable(recv)) continue;

            var pos = inv.GetLocation().GetLineSpan().StartLinePosition;
            yield return new Violation(
                RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                $"{name}() on an indexable list enumerates from the start — index directly (xs[0] / xs[^1] / xs[i]) instead.");
        }
    }

    private static bool IsIndexable(ITypeSymbol type)
    {
        if (type.TypeKind == TypeKind.Array) return true;
        foreach (var iface in type.AllInterfaces)
            if (iface is { Name: "IList", ContainingNamespace.Name: "Generic" })
                return true;
        // The type might itself be IList<T>.
        return type is INamedTypeSymbol { Name: "IList", ContainingNamespace.Name: "Generic" };
    }
}
