using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// An `if (set.Contains(x))` (or `if (!set.Contains(x))`) guard whose body only
/// calls `set.Add(x)` / `set.Remove(x)` on the same set with the same element.
/// `ISet.Add` and `ISet.Remove` already perform the lookup and return a bool, so
/// the `Contains` is a wasted second lookup. The receiver's resolved type (an
/// ISet&lt;T&gt; whose Add/Remove return bool) and matching the same set+element are
/// what make this precise. CA1868.
/// </summary>
internal sealed class RedundantContainsBeforeSetOp : ISemanticRule
{
    public string RuleKey => "performance/deterministic/redundant-contains-before-set-op";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var ifStmt in tree.GetRoot().DescendantNodes().OfType<IfStatementSyntax>())
        {
            var cond = Unwrap(ifStmt.Condition);
            // Allow a single leading `!` (the `if (!s.Contains) s.Add` shape).
            if (cond is PrefixUnaryExpressionSyntax { RawKind: (int)Microsoft.CodeAnalysis.CSharp.SyntaxKind.LogicalNotExpression } neg)
                cond = Unwrap(neg.Operand);

            if (cond is not InvocationExpressionSyntax containsInv) continue;
            if (containsInv.Expression is not MemberAccessExpressionSyntax containsMa) continue;
            if (containsMa.Name.Identifier.Text != "Contains") continue;
            if (containsInv.ArgumentList.Arguments.Count != 1) continue;
            if (!IsSetContains(model, containsInv)) continue;

            // The then-branch must be a single Add/Remove on the same set + element.
            var op = SingleSetOp(ifStmt.Statement);
            if (op is null) continue;
            if (op.Expression is not MemberAccessExpressionSyntax opMa) continue;
            if (opMa.Name.Identifier.Text is not ("Add" or "Remove")) continue;
            if (op.ArgumentList.Arguments.Count != 1) continue;
            if (!ReturnsBool(model, op)) continue;

            if (!SameReceiver(model, containsMa.Expression, opMa.Expression)) continue;
            if (!SameElement(containsInv.ArgumentList.Arguments[0].Expression,
                             op.ArgumentList.Arguments[0].Expression)) continue;

            var pos = ifStmt.GetLocation().GetLineSpan().StartLinePosition;
            yield return new Violation(
                RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                "Contains before Add/Remove on a set is a wasted lookup — Add/Remove already test membership and return a bool.");
        }
    }

    private static InvocationExpressionSyntax? SingleSetOp(StatementSyntax body)
    {
        var stmt = body is BlockSyntax { Statements: [var only] } ? only : body;
        return stmt is ExpressionStatementSyntax { Expression: InvocationExpressionSyntax inv } ? inv : null;
    }

    private static bool IsSetContains(SemanticModel model, InvocationExpressionSyntax inv)
    {
        if (model.GetSymbolInfo(inv).Symbol is not IMethodSymbol m) return false;
        if (m.Name != "Contains") return false;
        return ImplementsISet(m.ContainingType);
    }

    // Add/Remove that return bool: this is exactly the ISet<T> / HashSet<T> shape
    // (List<T>.Add returns void, Dictionary.Remove(key) returns bool but is keyed —
    // requiring an ISet receiver scopes us to genuine set semantics).
    private static bool ReturnsBool(SemanticModel model, InvocationExpressionSyntax inv) =>
        model.GetSymbolInfo(inv).Symbol is IMethodSymbol m &&
        m.ReturnType.SpecialType == SpecialType.System_Boolean &&
        ImplementsISet(m.ContainingType);

    private static bool ImplementsISet(ITypeSymbol? type)
    {
        if (type is null) return false;
        if (type is INamedTypeSymbol { Name: "ISet" or "HashSet" or "SortedSet", ContainingNamespace.Name: "Generic" })
            return true;
        foreach (var iface in type.AllInterfaces)
            if (iface is { Name: "ISet", ContainingNamespace.Name: "Generic" })
                return true;
        return false;
    }

    private static bool SameReceiver(SemanticModel model, ExpressionSyntax a, ExpressionSyntax b)
    {
        var sa = model.GetSymbolInfo(a).Symbol;
        var sb = model.GetSymbolInfo(b).Symbol;
        if (sa is not null && sb is not null)
            return SymbolEqualityComparer.Default.Equals(sa, sb);
        // Fall back to textual identity for `this`-style receivers without a symbol.
        return a.ToString() == b.ToString();
    }

    private static bool SameElement(ExpressionSyntax a, ExpressionSyntax b) =>
        Unwrap(a).ToString() == Unwrap(b).ToString();

    private static ExpressionSyntax Unwrap(ExpressionSyntax e)
    {
        while (e is ParenthesizedExpressionSyntax p) e = p.Expression;
        return e;
    }
}
