using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// A hand-written range guard that throws ArgumentOutOfRangeException, e.g.
/// `if (n &lt; 0) throw new ArgumentOutOfRangeException(...)`. The .NET 8
/// `ArgumentOutOfRangeException.ThrowIf*` helpers (ThrowIfNegative,
/// ThrowIfLessThan, ThrowIfGreaterThan, …) say the same in one line. We flag the
/// shape conservatively: a relational comparison guarding a single throw of
/// ArgumentOutOfRangeException. Needs symbol resolution to confirm the thrown type.
/// CA1512.
/// </summary>
internal sealed class UseArgumentOutOfRangeThrowHelper : ISemanticRule
{
    public string RuleKey => "code-quality/deterministic/use-argumentoutofrange-throwhelper";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var ifStmt in tree.GetRoot().DescendantNodes().OfType<IfStatementSyntax>())
        {
            if (ifStmt.Else is not null) continue;

            // Condition must be a single relational comparison (the helpers replace
            // exactly these). Compound `&&`/`||` conditions don't map to one helper.
            if (ifStmt.Condition is not BinaryExpressionSyntax bin) continue;
            if (!IsRelational(bin.OperatorToken)) continue;

            // The single throw must construct System.ArgumentOutOfRangeException.
            if (SingleThrow(ifStmt.Statement) is not ObjectCreationExpressionSyntax create) continue;
            if (model.GetSymbolInfo(create.Type).Symbol is not INamedTypeSymbol thrown) continue;
            if (thrown.ToDisplayString() != "System.ArgumentOutOfRangeException") continue;

            var pos = ifStmt.GetLocation().GetLineSpan().StartLinePosition;
            yield return new Violation(
                RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                "Manual range guard can be replaced by an ArgumentOutOfRangeException.ThrowIf* helper.");
        }
    }

    private static bool IsRelational(SyntaxToken op) => op.Kind() is
        SyntaxKind.LessThanToken or SyntaxKind.LessThanEqualsToken or
        SyntaxKind.GreaterThanToken or SyntaxKind.GreaterThanEqualsToken;

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
