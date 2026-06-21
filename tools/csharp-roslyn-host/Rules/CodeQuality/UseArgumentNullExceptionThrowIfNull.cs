using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// A hand-written `if (arg == null) throw new ArgumentNullException(nameof(arg));`
/// guard that restates the one-line `ArgumentNullException.ThrowIfNull(arg)` helper.
/// The helper cannot get the parameter name wrong and is clearer. Needs semantic
/// resolution to confirm the thrown type is System.ArgumentNullException and the
/// tested expression is the same parameter/local being null-checked. RCS1255.
/// </summary>
internal sealed class UseArgumentNullExceptionThrowIfNull : ISemanticRule
{
    public string RuleKey => "code-quality/deterministic/use-argumentnullexception-throwifnull";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var ifStmt in tree.GetRoot().DescendantNodes().OfType<IfStatementSyntax>())
        {
            if (ifStmt.Else is not null) continue;

            // Condition must be `<expr> == null` or `<expr> is null`.
            var tested = NullCheckOperand(ifStmt.Condition);
            if (tested is null) continue;

            // Body must be exactly one statement that throws.
            var throwStmt = SingleThrow(ifStmt.Statement);
            if (throwStmt is not ObjectCreationExpressionSyntax create) continue;

            // The thrown type must be System.ArgumentNullException (exactly).
            if (model.GetSymbolInfo(create.Type).Symbol is not INamedTypeSymbol thrown) continue;
            if (thrown.ToDisplayString() != "System.ArgumentNullException") continue;

            // The tested expression must be a simple parameter or local reference, so the
            // ThrowIfNull rewrite is mechanical and safe.
            if (model.GetSymbolInfo(tested).Symbol is not (IParameterSymbol or ILocalSymbol)) continue;

            var pos = ifStmt.GetLocation().GetLineSpan().StartLinePosition;
            yield return new Violation(
                RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                "Manual null-guard restates ArgumentNullException.ThrowIfNull(arg); use the throw helper to avoid name drift.");
        }
    }

    /// Returns the operand X for `X == null`, `null == X`, or `X is null`; else null.
    private static ExpressionSyntax? NullCheckOperand(ExpressionSyntax cond)
    {
        switch (cond)
        {
            case BinaryExpressionSyntax bin when bin.OperatorToken.IsKind(SyntaxKind.EqualsEqualsToken):
                if (bin.Right.IsKind(SyntaxKind.NullLiteralExpression)) return bin.Left;
                if (bin.Left.IsKind(SyntaxKind.NullLiteralExpression)) return bin.Right;
                return null;
            case IsPatternExpressionSyntax { Pattern: ConstantPatternSyntax cp } isPat
                when cp.Expression.IsKind(SyntaxKind.NullLiteralExpression):
                return isPat.Expression;
            default:
                return null;
        }
    }

    /// Returns the thrown expression iff `stmt` is exactly one `throw new …;`.
    private static ExpressionSyntax? SingleThrow(StatementSyntax stmt)
    {
        var t = stmt switch
        {
            ThrowStatementSyntax ts => ts,
            BlockSyntax { Statements: [ThrowStatementSyntax only] } => only,
            _ => null,
        };
        return t?.Expression;
    }
}
