using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// `string.Concat(...)` where at least one argument is a `string.Substring(...)`
/// call. Each Substring allocates an intermediate string just to be concatenated
/// away; `string.Concat(ReadOnlySpan&lt;char&gt;, ...)` with `AsSpan(start, len)`
/// slices without copying. Binding both the Concat target and the Substring call to
/// `string` is what makes this precise. CA1845.
/// </summary>
internal sealed class UseSpanStringConcat : ISemanticRule
{
    public string RuleKey => "performance/deterministic/use-span-string-concat";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var inv in tree.GetRoot().DescendantNodes().OfType<InvocationExpressionSyntax>())
        {
            if (!IsStringConcat(model, inv)) continue;

            var hasSubstringArg = inv.ArgumentList.Arguments
                .Any(a => IsStringSubstring(model, a.Expression));
            if (!hasSubstringArg) continue;

            var pos = inv.GetLocation().GetLineSpan().StartLinePosition;
            yield return new Violation(
                RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                "string.Concat with Substring arguments allocates intermediate strings — slice with AsSpan and use the span overload of string.Concat.");
        }
    }

    private static bool IsStringConcat(SemanticModel model, InvocationExpressionSyntax inv)
    {
        // Either `string.Concat(...)` or `String.Concat(...)`.
        var name = inv.Expression switch
        {
            MemberAccessExpressionSyntax ma => ma.Name.Identifier.Text,
            _ => null,
        };
        if (name != "Concat") return false;
        if (model.GetSymbolInfo(inv).Symbol is not IMethodSymbol m) return false;
        return m.Name == "Concat" && m.ContainingType?.SpecialType == SpecialType.System_String;
    }

    private static bool IsStringSubstring(SemanticModel model, ExpressionSyntax expr)
    {
        while (expr is ParenthesizedExpressionSyntax p) expr = p.Expression;
        if (expr is not InvocationExpressionSyntax inv) return false;
        if (inv.Expression is not MemberAccessExpressionSyntax { Name.Identifier.Text: "Substring" }) return false;
        return model.GetSymbolInfo(inv).Symbol is IMethodSymbol m &&
               m.Name == "Substring" && m.ContainingType?.SpecialType == SpecialType.System_String;
    }
}
