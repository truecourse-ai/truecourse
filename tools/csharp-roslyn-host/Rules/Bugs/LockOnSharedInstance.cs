using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// `lock` taken on a publicly reachable / process-shared object: `this`, `typeof(T)` (a
/// per-process interned Type), or a string literal/constant (interned across the whole
/// AppDomain). Unrelated code can lock the same instance, so the lock can deadlock or be
/// defeated. Distinguishing these targets — especially `typeof` and interned strings —
/// needs the resolved type, hence the semantic model.
/// </summary>
internal sealed class LockOnSharedInstance : ISemanticRule
{
    public string RuleKey => "bugs/deterministic/lock-on-shared-instance";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var stmt in tree.GetRoot().DescendantNodes().OfType<LockStatementSyntax>())
        {
            var expr = stmt.Expression;
            string? why = expr switch
            {
                ThisExpressionSyntax => "'this' — any external holder of this object can lock it too",
                TypeOfExpressionSyntax => "a 'typeof(...)' Type instance, which is shared across the whole process",
                _ when IsStringConstant(expr, model) => "an interned string, which is shared across the AppDomain",
                _ => null,
            };
            if (why is null) continue;

            var pos = expr.GetLocation().GetLineSpan().StartLinePosition;
            yield return new Violation(
                RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                $"lock on {why} — lock on a private, readonly, dedicated object instead to avoid cross-component deadlocks.");
        }
    }

    private static bool IsStringConstant(ExpressionSyntax expr, SemanticModel model)
    {
        if (model.GetTypeInfo(expr).Type?.SpecialType != SpecialType.System_String) return false;
        // A string literal, or a const string field/local — both are interned and shared.
        if (expr is LiteralExpressionSyntax) return true;
        var c = model.GetConstantValue(expr);
        return c is { HasValue: true, Value: string };
    }
}
