using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// `str.IndexOf(x)` whose result is compared only to detect presence/absence
/// (`>= 0`, `< 0`, `== -1`, `!= -1`), where `string.Contains` reads more clearly and
/// avoids the off-by-one trap. Needs the resolved method to confirm it is
/// `System.String.IndexOf`. CA2249.
/// </summary>
internal sealed class IndexOfForPresenceCheck : ISemanticRule
{
    public string RuleKey => "code-quality/deterministic/indexof-for-presence-check";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var bin in tree.GetRoot().DescendantNodes().OfType<BinaryExpressionSyntax>())
        {
            var op = bin.OperatorToken.Text;
            if (op is not (">=" or "<" or ">" or "<=" or "==" or "!=")) continue;

            var (call, literalValue) = MatchPresencePattern(bin, model);
            if (call is null) continue;

            // Confirm the comparison shape actually expresses presence/absence:
            //   IndexOf(...) >= 0 | > -1 | == -1 | != -1 | < 0
            if (!IsPresenceComparison(op, literalValue)) continue;

            var pos = call.GetLocation().GetLineSpan().StartLinePosition;
            yield return new Violation(
                RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                "string.IndexOf is compared only to test presence; use string.Contains for clarity.");
        }
    }

    /// Returns (the IndexOf invocation, the integer literal it is compared with) when
    /// the LEFT side is a String.IndexOf call and the right is an int literal. We only
    /// match this orientation so the operator's meaning is unambiguous.
    private (InvocationExpressionSyntax?, int) MatchPresencePattern(BinaryExpressionSyntax bin, SemanticModel model)
    {
        if (IsStringIndexOf(bin.Left, model) && TryConstInt(bin.Right, model, out var rv))
            return ((InvocationExpressionSyntax)bin.Left, rv);
        return (null, 0);
    }

    private static bool IsStringIndexOf(ExpressionSyntax expr, SemanticModel model)
    {
        if (expr is not InvocationExpressionSyntax inv) return false;
        if (model.GetSymbolInfo(inv).Symbol is not IMethodSymbol m) return false;
        return m.Name == "IndexOf" && m.ContainingType?.SpecialType == SpecialType.System_String;
    }

    private static bool TryConstInt(ExpressionSyntax expr, SemanticModel model, out int value)
    {
        value = 0;
        var c = model.GetConstantValue(expr);
        if (c is { HasValue: true, Value: int i }) { value = i; return true; }
        return false;
    }

    /// Only the canonical presence/absence comparisons (against 0 or -1) qualify.
    /// Comparisons against other indices express position, not presence.
    private static bool IsPresenceComparison(string op, int value) => (op, value) switch
    {
        (">=", 0) => true,
        ("<", 0) => true,
        (">", -1) => true,
        ("<=", -1) => true,
        ("==", -1) => true,
        ("!=", -1) => true,
        _ => false,
    };
}
