using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// The eager bitwise `&` / `|` operators used on boolean operands where the
/// short-circuit `&&` / `||` was almost certainly intended: the right operand
/// always runs even when the left already decides the result. We require the right
/// operand to be a method call (a genuine side-effect / skippable cost) so that
/// deliberate branchless bitwise math is never flagged. S2178 / RCS1233.
/// </summary>
internal sealed class NonShortCircuitBoolean : ISemanticRule
{
    public string RuleKey => "bugs/deterministic/non-short-circuit-boolean";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var bin in tree.GetRoot().DescendantNodes().OfType<BinaryExpressionSyntax>())
        {
            if (!bin.IsKind(SyntaxKind.BitwiseAndExpression) && !bin.IsKind(SyntaxKind.BitwiseOrExpression))
                continue;

            // Both operands must be bool (an enum/integer & is legitimate bit math).
            var left = model.GetTypeInfo(bin.Left).Type;
            var right = model.GetTypeInfo(bin.Right).Type;
            if (left?.SpecialType != SpecialType.System_Boolean) continue;
            if (right?.SpecialType != SpecialType.System_Boolean) continue;

            // Skippable cost only matters if the RIGHT operand can have side effects or
            // is non-trivial — restrict to a method invocation to guarantee no FP.
            if (!ContainsInvocation(bin.Right)) continue;

            var pos = bin.OperatorToken.GetLocation().GetLineSpan().StartLinePosition;
            var want = bin.IsKind(SyntaxKind.BitwiseAndExpression) ? "&&" : "||";
            yield return new Violation(
                RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                $"Eager '{bin.OperatorToken.Text}' on boolean operands always evaluates the right-hand call — use '{want}' to short-circuit.");
        }
    }

    private static bool ContainsInvocation(ExpressionSyntax expr)
    {
        var e = expr;
        while (e is ParenthesizedExpressionSyntax p) e = p.Expression;
        return e is InvocationExpressionSyntax ||
               e.DescendantNodes().OfType<InvocationExpressionSyntax>().Any();
    }
}
