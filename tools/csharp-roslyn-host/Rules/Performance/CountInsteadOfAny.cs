using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// `Enumerable.Count()` / `LongCount()` whose only use is a comparison against
/// zero (e.g. `xs.Count() > 0`, `xs.Count() == 0`). `Any()` short-circuits on the
/// first element instead of enumerating the whole sequence. Binding to the LINQ
/// extension (not a List.Count property) is what makes this precise. CA1827.
/// </summary>
internal sealed class CountInsteadOfAny : ISemanticRule
{
    public string RuleKey => "performance/deterministic/count-instead-of-any";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var bin in tree.GetRoot().DescendantNodes().OfType<BinaryExpressionSyntax>())
        {
            if (!IsZeroComparison(bin, out var countSide)) continue;
            if (countSide is null) continue;

            if (!IsLinqCount(model, countSide)) continue;

            var pos = countSide.GetLocation().GetLineSpan().StartLinePosition;
            yield return new Violation(
                RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                "Count() is compared to zero only to test for elements — Any() short-circuits on the first element instead of enumerating the whole sequence.");
        }
    }

    private static bool IsZeroComparison(BinaryExpressionSyntax bin, out InvocationExpressionSyntax? countSide)
    {
        countSide = null;
        var kind = bin.Kind();
        var isComparison = kind is SyntaxKind.EqualsExpression or SyntaxKind.NotEqualsExpression
            or SyntaxKind.GreaterThanExpression or SyntaxKind.GreaterThanOrEqualExpression
            or SyntaxKind.LessThanExpression or SyntaxKind.LessThanOrEqualExpression;
        if (!isComparison) return false;

        var left = Unwrap(bin.Left);
        var right = Unwrap(bin.Right);

        if (IsZeroOrOne(right) && left is InvocationExpressionSyntax li) { countSide = li; return true; }
        if (IsZeroOrOne(left) && right is InvocationExpressionSyntax ri) { countSide = ri; return true; }
        return false;
    }

    // 0 covers `> 0`, `== 0`; 1 covers `>= 1`, `< 1` — all reducible to Any().
    private static bool IsZeroOrOne(ExpressionSyntax e) =>
        e is LiteralExpressionSyntax { Token.ValueText: "0" or "1" };

    private static ExpressionSyntax Unwrap(ExpressionSyntax e)
    {
        while (e is ParenthesizedExpressionSyntax p) e = p.Expression;
        return e;
    }

    private static bool IsLinqCount(SemanticModel model, InvocationExpressionSyntax inv)
    {
        if (model.GetSymbolInfo(inv).Symbol is not IMethodSymbol m) return false;
        if (m.Name is not ("Count" or "LongCount")) return false;
        // Must be the Enumerable/Queryable extension, not List<T>.Count (a property,
        // which would not bind to a method) — and reduced extension form.
        return m.IsExtensionMethod &&
               m.ContainingType is { Name: "Enumerable" or "Queryable" };
    }
}
