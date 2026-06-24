using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// A hand-written guard that throws ArgumentException for a null-or-empty string,
/// e.g. `if (string.IsNullOrEmpty(s)) throw new ArgumentException(...)`. The dedicated
/// `ArgumentException.ThrowIfNullOrEmpty(s)` helper expresses this in one line and
/// can't misname the parameter. Needs symbol resolution to confirm the guard's
/// condition is the String.IsNullOrEmpty/IsNullOrWhiteSpace call and the thrown type
/// is ArgumentException. CA1511.
/// </summary>
internal sealed class UseArgumentExceptionThrowHelper : ISemanticRule
{
    public string RuleKey => "code-quality/deterministic/use-argumentexception-throwhelper";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var ifStmt in tree.GetRoot().DescendantNodes().OfType<IfStatementSyntax>())
        {
            if (ifStmt.Else is not null) continue;

            // Condition must be string.IsNullOrEmpty(x) / string.IsNullOrWhiteSpace(x).
            if (ifStmt.Condition is not InvocationExpressionSyntax cond) continue;
            if (model.GetSymbolInfo(cond).Symbol is not IMethodSymbol guard) continue;
            if (guard.ContainingType?.SpecialType != SpecialType.System_String) continue;
            if (guard.Name is not ("IsNullOrEmpty" or "IsNullOrWhiteSpace")) continue;
            if (cond.ArgumentList.Arguments.Count != 1) continue;

            // The single throw must construct System.ArgumentException.
            if (SingleThrow(ifStmt.Statement) is not ObjectCreationExpressionSyntax create) continue;
            if (model.GetSymbolInfo(create.Type).Symbol is not INamedTypeSymbol thrown) continue;
            if (thrown.ToDisplayString() != "System.ArgumentException") continue;

            var helper = guard.Name == "IsNullOrEmpty"
                ? "ArgumentException.ThrowIfNullOrEmpty"
                : "ArgumentException.ThrowIfNullOrWhiteSpace";
            var pos = ifStmt.GetLocation().GetLineSpan().StartLinePosition;
            yield return new Violation(
                RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                $"Manual null/empty guard can be replaced by {helper}(arg).");
        }
    }

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
