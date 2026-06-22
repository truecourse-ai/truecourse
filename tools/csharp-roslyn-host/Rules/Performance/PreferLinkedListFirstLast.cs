using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// The argument-less LINQ `First()` / `Last()` extension called on a
/// `LinkedList&lt;T&gt;`, which exposes O(1) `First` / `Last` properties. The LINQ
/// extensions walk the list; the properties are direct. Receiver type resolution
/// (the concrete LinkedList type) is what makes this safe.
/// </summary>
internal sealed class PreferLinkedListFirstLast : ISemanticRule
{
    public string RuleKey => "performance/deterministic/prefer-linkedlist-first-last";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var inv in tree.GetRoot().DescendantNodes().OfType<InvocationExpressionSyntax>())
        {
            if (inv.Expression is not MemberAccessExpressionSyntax ma) continue;
            if (ma.Name.Identifier.Text is not ("First" or "Last")) continue;
            if (inv.ArgumentList.Arguments.Count != 0) continue;

            if (model.GetSymbolInfo(inv).Symbol is not IMethodSymbol m) continue;
            if (!m.IsExtensionMethod || m.ContainingType?.Name != "Enumerable") continue;

            var recv = model.GetTypeInfo(ma.Expression).Type;
            if (recv is not INamedTypeSymbol { Name: "LinkedList", ContainingNamespace.Name: "Generic" })
                continue;

            var pos = inv.GetLocation().GetLineSpan().StartLinePosition;
            yield return new Violation(
                RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                "First()/Last() on a LinkedList walks the list — use the O(1) First/Last properties.");
        }
    }
}
