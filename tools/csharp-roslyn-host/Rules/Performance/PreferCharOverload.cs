using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// `string.StartsWith("x")` / `string.EndsWith("x")` called with a one-character
/// string literal, where the `char` overload performs a direct character compare
/// instead of culture-aware substring matching. Binding to the string overload of
/// `string.StartsWith`/`EndsWith` is what makes this precise. CA1865.
/// (string.Contains is covered separately by string-contains-char.)
/// </summary>
internal sealed class PreferCharOverload : ISemanticRule
{
    public string RuleKey => "performance/deterministic/prefer-char-overload";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var inv in tree.GetRoot().DescendantNodes().OfType<InvocationExpressionSyntax>())
        {
            if (inv.Expression is not MemberAccessExpressionSyntax ma) continue;
            if (ma.Name.Identifier.Text is not ("StartsWith" or "EndsWith")) continue;
            // Only the single-argument overload has a char counterpart; the culture/
            // comparison overloads do not, so we restrict to exactly one argument.
            if (inv.ArgumentList.Arguments.Count != 1) continue;
            if (!IsSingleCharStringLiteral(inv.ArgumentList.Arguments[0].Expression)) continue;

            if (model.GetSymbolInfo(inv).Symbol is not IMethodSymbol m) continue;
            if (m.ContainingType?.SpecialType != SpecialType.System_String) continue;
            if (m.Parameters.Length != 1 || m.Parameters[0].Type.SpecialType != SpecialType.System_String) continue;

            var pos = inv.GetLocation().GetLineSpan().StartLinePosition;
            yield return new Violation(
                RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                $"string.{ma.Name.Identifier.Text}(\"x\") does culture-aware substring matching — pass a char literal to use the direct char overload.");
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
