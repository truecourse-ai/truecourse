using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// A LINQ `OrderBy` / `OrderByDescending` whose receiver is itself the result of
/// another `OrderBy` / `OrderByDescending`. The second sort discards the first
/// ordering entirely — `ThenBy` was almost certainly intended. Binding both calls
/// to the LINQ extensions (so a user method named OrderBy is not flagged) is what
/// makes this precise.
/// </summary>
internal sealed class MultipleOrderBy : ISemanticRule
{
    public string RuleKey => "performance/deterministic/multiple-orderby";

    private static readonly HashSet<string> OrderMethods = new()
    {
        "OrderBy", "OrderByDescending",
    };

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var inv in tree.GetRoot().DescendantNodes().OfType<InvocationExpressionSyntax>())
        {
            if (inv.Expression is not MemberAccessExpressionSyntax ma) continue;
            if (!OrderMethods.Contains(ma.Name.Identifier.Text)) continue;
            if (!IsLinqOrder(model, inv)) continue;

            // The receiver expression must itself be an OrderBy/OrderByDescending call.
            if (ma.Expression is not InvocationExpressionSyntax inner) continue;
            if (inner.Expression is not MemberAccessExpressionSyntax innerMa) continue;
            if (!OrderMethods.Contains(innerMa.Name.Identifier.Text)) continue;
            if (!IsLinqOrder(model, inner)) continue;

            var pos = inv.GetLocation().GetLineSpan().StartLinePosition;
            yield return new Violation(
                RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                "A second OrderBy discards the first ordering — chain ThenBy/ThenByDescending to sort by multiple keys.");
        }
    }

    private static bool IsLinqOrder(SemanticModel model, InvocationExpressionSyntax inv) =>
        model.GetSymbolInfo(inv).Symbol is IMethodSymbol { IsExtensionMethod: true } m &&
        m.ContainingType is { Name: "Enumerable" or "Queryable" } &&
        m.Name is "OrderBy" or "OrderByDescending";
}
