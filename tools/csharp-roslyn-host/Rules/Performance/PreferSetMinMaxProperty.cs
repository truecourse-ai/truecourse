using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// The argument-less LINQ `Min()` / `Max()` extension called on a
/// `SortedSet&lt;T&gt;`, which exposes O(1) `Min` / `Max` properties (the set is
/// kept ordered). The LINQ extensions scan the whole set. Receiver type resolution
/// (the concrete SortedSet type) is what makes this safe.
/// </summary>
internal sealed class PreferSetMinMaxProperty : ISemanticRule
{
    public string RuleKey => "performance/deterministic/prefer-set-minmax-property";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var inv in tree.GetRoot().DescendantNodes().OfType<InvocationExpressionSyntax>())
        {
            if (inv.Expression is not MemberAccessExpressionSyntax ma) continue;
            if (ma.Name.Identifier.Text is not ("Min" or "Max")) continue;
            if (inv.ArgumentList.Arguments.Count != 0) continue; // no selector overload

            if (model.GetSymbolInfo(inv).Symbol is not IMethodSymbol m) continue;
            if (!m.IsExtensionMethod || m.ContainingType?.Name != "Enumerable") continue;

            var recv = model.GetTypeInfo(ma.Expression).Type;
            if (recv is not INamedTypeSymbol { Name: "SortedSet", ContainingNamespace.Name: "Generic" })
                continue;

            var pos = inv.GetLocation().GetLineSpan().StartLinePosition;
            yield return new Violation(
                RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                "Min()/Max() on a SortedSet scans the whole set — use the O(1) Min/Max properties.");
        }
    }
}
