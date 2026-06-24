using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// A prefix test written as `s.IndexOf(x) == 0` (or `!= 0`). `StartsWith` stops at
/// the first mismatch, whereas `IndexOf` scans the whole string before returning.
/// Binding the call to `string.IndexOf` (not List.IndexOf, where the equivalent
/// rewrite differs) is what makes this precise. CA1858.
/// </summary>
internal sealed class StartsWithOverIndexOfZero : ISemanticRule
{
    public string RuleKey => "performance/deterministic/startswith-over-indexof-zero";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var bin in tree.GetRoot().DescendantNodes().OfType<BinaryExpressionSyntax>())
        {
            if (!bin.IsKind(SyntaxKind.EqualsExpression) && !bin.IsKind(SyntaxKind.NotEqualsExpression))
                continue;

            var inv = MatchIndexOfZero(bin);
            if (inv is null) continue;
            if (!IsStringIndexOf(model, inv)) continue;

            var pos = bin.GetLocation().GetLineSpan().StartLinePosition;
            yield return new Violation(
                RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                "IndexOf(...) == 0 scans the whole string to test a prefix — StartsWith stops at the first mismatch.");
        }
    }

    private static InvocationExpressionSyntax? MatchIndexOfZero(BinaryExpressionSyntax bin)
    {
        var left = Unwrap(bin.Left);
        var right = Unwrap(bin.Right);
        if (IsZero(right) && left is InvocationExpressionSyntax li && IsIndexOfCall(li)) return li;
        if (IsZero(left) && right is InvocationExpressionSyntax ri && IsIndexOfCall(ri)) return ri;
        return null;
    }

    private static bool IsIndexOfCall(InvocationExpressionSyntax inv) =>
        inv.Expression is MemberAccessExpressionSyntax { Name.Identifier.Text: "IndexOf" } &&
        inv.ArgumentList.Arguments.Count >= 1;

    private static bool IsStringIndexOf(SemanticModel model, InvocationExpressionSyntax inv) =>
        model.GetSymbolInfo(inv).Symbol is IMethodSymbol m &&
        m.Name == "IndexOf" && m.ContainingType?.SpecialType == SpecialType.System_String;

    private static bool IsZero(ExpressionSyntax e) =>
        e is LiteralExpressionSyntax { Token.ValueText: "0" };

    private static ExpressionSyntax Unwrap(ExpressionSyntax e)
    {
        while (e is ParenthesizedExpressionSyntax p) e = p.Expression;
        return e;
    }
}
