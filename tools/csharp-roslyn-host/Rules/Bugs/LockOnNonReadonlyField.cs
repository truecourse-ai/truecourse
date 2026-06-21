using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// `lock` taken on a non-readonly instance/static field. Because the field can be
/// reassigned, two threads may lock different object instances and the mutual
/// exclusion is silently defeated. Needs symbol resolution to confirm the lock
/// target is a writable field. S2445.
/// </summary>
internal sealed class LockOnNonReadonlyField : ISemanticRule
{
    public string RuleKey => "bugs/deterministic/lock-on-non-readonly-field";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var stmt in tree.GetRoot().DescendantNodes().OfType<LockStatementSyntax>())
        {
            // Only a bare field reference (`field` or `this.field`) is a clear hazard;
            // arbitrary expressions are out of scope.
            var expr = stmt.Expression;
            if (expr is MemberAccessExpressionSyntax { Expression: ThisExpressionSyntax } ma)
                expr = ma.Name;
            if (expr is not (IdentifierNameSyntax or MemberAccessExpressionSyntax)) continue;

            if (model.GetSymbolInfo(stmt.Expression).Symbol is not IFieldSymbol f) continue;
            if (f.IsReadOnly || f.IsConst) continue;

            var pos = stmt.Expression.GetLocation().GetLineSpan().StartLinePosition;
            yield return new Violation(
                RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                $"lock on non-readonly field '{f.Name}' — reassigning the field lets two threads lock different objects, defeating mutual exclusion. Make it readonly.");
        }
    }
}
