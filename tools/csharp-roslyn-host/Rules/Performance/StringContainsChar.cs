using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// `string.Contains("x")` called with a one-character string literal, where the
/// `Contains(char)` overload avoids substring searching. Binding to the
/// `string.Contains` whose first parameter is a string (not the char overload, and
/// not a List/Span Contains) is what makes this precise. CA1847.
/// </summary>
internal sealed class StringContainsChar : ISemanticRule
{
    public string RuleKey => "performance/deterministic/string-contains-char";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var inv in tree.GetRoot().DescendantNodes().OfType<InvocationExpressionSyntax>())
        {
            if (inv.Expression is not MemberAccessExpressionSyntax ma) continue;
            if (ma.Name.Identifier.Text != "Contains") continue;
            if (inv.ArgumentList.Arguments.Count < 1) continue;

            // First argument must be a single-character string literal.
            if (!IsSingleCharStringLiteral(inv.ArgumentList.Arguments[0].Expression)) continue;

            if (model.GetSymbolInfo(inv).Symbol is not IMethodSymbol m) continue;
            if (m.Name != "Contains" || m.ContainingType?.SpecialType != SpecialType.System_String) continue;
            // The resolved overload's first parameter is a string (the one we want to
            // swap for the char overload).
            if (m.Parameters.Length < 1 || m.Parameters[0].Type.SpecialType != SpecialType.System_String) continue;

            var pos = inv.GetLocation().GetLineSpan().StartLinePosition;
            yield return new Violation(
                RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                "string.Contains(\"x\") searches for a substring — pass a char literal ('x') to use the cheaper char overload.");
        }
    }

    private static bool IsSingleCharStringLiteral(ExpressionSyntax e)
    {
        while (e is ParenthesizedExpressionSyntax p) e = p.Expression;
        return e is LiteralExpressionSyntax lit &&
               lit.IsKind(SyntaxKind.StringLiteralExpression) &&
               lit.Token.ValueText.Length == 1;
    }
}
