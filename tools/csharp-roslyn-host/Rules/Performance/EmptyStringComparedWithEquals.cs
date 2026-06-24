using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// A string tested for emptiness by comparing to the literal `""` — either with
/// `==`/`!=` or `s.Equals("")` / `"".Equals(s)`. Comparing characters is slower
/// than checking `Length == 0` (or `string.IsNullOrEmpty`). The operand's resolved
/// type (string) is what avoids flagging unrelated `== ""` shapes. CA1820.
/// </summary>
internal sealed class EmptyStringComparedWithEquals : ISemanticRule
{
    public string RuleKey => "performance/deterministic/empty-string-compared-with-equals";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var node in tree.GetRoot().DescendantNodes())
        {
            Location? loc = node switch
            {
                BinaryExpressionSyntax bin when IsEmptyStringEquality(model, bin) => bin.GetLocation(),
                InvocationExpressionSyntax inv when IsEqualsEmptyString(model, inv) => inv.GetLocation(),
                _ => null,
            };
            if (loc is null) continue;

            var pos = loc.GetLineSpan().StartLinePosition;
            yield return new Violation(
                RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                "Comparing a string to \"\" tests emptiness char-by-char — use Length == 0 or string.IsNullOrEmpty.");
        }
    }

    private static bool IsEmptyStringEquality(SemanticModel model, BinaryExpressionSyntax bin)
    {
        if (!bin.IsKind(SyntaxKind.EqualsExpression) && !bin.IsKind(SyntaxKind.NotEqualsExpression))
            return false;

        var (other, isLitEmpty) = EmptyOnOneSide(bin);
        if (!isLitEmpty || other is null) return false;
        return model.GetTypeInfo(other).Type?.SpecialType == SpecialType.System_String;
    }

    private static (ExpressionSyntax? other, bool litEmpty) EmptyOnOneSide(BinaryExpressionSyntax bin)
    {
        if (IsEmptyStringLiteral(bin.Right)) return (bin.Left, true);
        if (IsEmptyStringLiteral(bin.Left)) return (bin.Right, true);
        return (null, false);
    }

    private static bool IsEqualsEmptyString(SemanticModel model, InvocationExpressionSyntax inv)
    {
        if (inv.Expression is not MemberAccessExpressionSyntax ma) return false;
        if (ma.Name.Identifier.Text != "Equals") return false;
        if (model.GetSymbolInfo(inv).Symbol is not IMethodSymbol m) return false;
        if (m.Name != "Equals" || m.ContainingType?.SpecialType != SpecialType.System_String) return false;

        // Either receiver or any argument is "".
        if (IsEmptyStringLiteral(ma.Expression)) return true;
        foreach (var arg in inv.ArgumentList.Arguments)
            if (IsEmptyStringLiteral(arg.Expression)) return true;
        return false;
    }

    private static bool IsEmptyStringLiteral(ExpressionSyntax e)
    {
        while (e is ParenthesizedExpressionSyntax p) e = p.Expression;
        return e is LiteralExpressionSyntax { Token.ValueText: "" } lit &&
               lit.IsKind(SyntaxKind.StringLiteralExpression);
    }
}
