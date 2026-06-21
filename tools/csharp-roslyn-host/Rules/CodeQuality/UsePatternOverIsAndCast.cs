using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// `x is T` followed by a `(T)x` cast of the same expression to the same type, where
/// the type-pattern `x is T t` would test and bind in one step and remove the
/// second, potentially-divergent cast. Needs symbol resolution to confirm `x` is the
/// same symbol and `T` the same type in both places. RCS1220.
/// </summary>
internal sealed class UsePatternOverIsAndCast : ISemanticRule
{
    public string RuleKey => "code-quality/deterministic/use-pattern-over-is-and-cast";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var isExpr in tree.GetRoot().DescendantNodes().OfType<BinaryExpressionSyntax>())
        {
            if (isExpr.OperatorToken.Text != "is") continue;
            // Right side must be a bare type (a type-pattern `is T t` is the fix itself).
            if (isExpr.Right is not TypeSyntax typeSyntax) continue;
            if (model.GetTypeInfo(typeSyntax).Type is not { } testedType) continue;
            if (model.GetSymbolInfo(isExpr.Left).Symbol is not { } leftSym) continue;
            // Only a stable local/parameter/field reference is safe to rewrite.
            if (leftSym is not (ILocalSymbol or IParameterSymbol or IFieldSymbol)) continue;

            // Find the statement / member that guards on this `is`, then look for a cast
            // of the same symbol to the same type inside its governed block.
            var scope = GuardedScope(isExpr);
            if (scope is null) continue;

            foreach (var cast in scope.DescendantNodes().OfType<CastExpressionSyntax>())
            {
                if (model.GetTypeInfo(cast.Type).Type is not { } castType) continue;
                if (!SymbolEqualityComparer.Default.Equals(castType, testedType)) continue;
                if (model.GetSymbolInfo(cast.Expression).Symbol is not { } castSym) continue;
                if (!SymbolEqualityComparer.Default.Equals(castSym, leftSym)) continue;

                var pos = cast.GetLocation().GetLineSpan().StartLinePosition;
                yield return new Violation(
                    RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                    $"'{leftSym.Name} is {testedType.Name}' is followed by a '({testedType.Name})' cast; use the type pattern '{leftSym.Name} is {testedType.Name} value' to test and bind in one step.");
                break; // one finding per is-expression
            }
        }
    }

    /// The syntactic region governed by an `is` test: the `then` branch of an `if`, or
    /// the enclosing statement when it is the whole condition. Conservative — returns
    /// null for compound conditions we cannot prove dominate the cast.
    private static SyntaxNode? GuardedScope(BinaryExpressionSyntax isExpr)
    {
        // `if (x is T) { ... (T)x ... }`
        if (isExpr.Parent is IfStatementSyntax ifStmt && ifStmt.Condition == isExpr)
            return ifStmt.Statement;
        return null;
    }
}
