using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// A symbol and a member of that same symbol are assigned in one chained statement, e.g.
/// `x = x.Member = value` or `a.B = a.B.C = value`, leaving it ambiguous which write the
/// author meant and which value the member ends up reading. We resolve the right-hand
/// assignment's target to confirm it is a member access whose receiver is the very symbol
/// (or an access path off it) being assigned on the left — needs the semantic model. CA2246.
/// </summary>
internal sealed class SymbolAndMemberSameStatement : ISemanticRule
{
    public string RuleKey => "bugs/deterministic/symbol-and-member-same-statement";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var outer in tree.GetRoot().DescendantNodes().OfType<AssignmentExpressionSyntax>())
        {
            if (!outer.IsKind(SyntaxKind.SimpleAssignmentExpression)) continue;
            // Chained assignment: RHS is itself a simple assignment `inner = value`.
            if (outer.Right is not AssignmentExpressionSyntax inner ||
                !inner.IsKind(SyntaxKind.SimpleAssignmentExpression))
                continue;

            var outerSym = model.GetSymbolInfo(outer.Left).Symbol;
            if (outerSym is null) continue;

            // The inner target must be a member access whose receiver chain roots at outerSym.
            if (inner.Left is not MemberAccessExpressionSyntax innerMember) continue;
            var rootSym = RootSymbol(innerMember.Expression, model);
            if (rootSym is null) continue;
            if (!SymbolEqualityComparer.Default.Equals(rootSym, outerSym)) continue;

            var pos = outer.GetLocation().GetLineSpan().StartLinePosition;
            yield return new Violation(
                RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                $"'{outerSym.Name}' and its member '{innerMember.Name.Identifier.ValueText}' are assigned in the same statement — it is ambiguous whether the old or new '{outerSym.Name}' was intended; split into separate statements.");
        }
    }

    private static ISymbol? RootSymbol(ExpressionSyntax expr, SemanticModel model) => expr switch
    {
        IdentifierNameSyntax => model.GetSymbolInfo(expr).Symbol,
        MemberAccessExpressionSyntax ma => RootSymbol(ma.Expression, model),
        ParenthesizedExpressionSyntax pe => RootSymbol(pe.Expression, model),
        _ => null,
    };
}
