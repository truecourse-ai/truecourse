using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// `s += ...` where `s` is a string, inside a loop body. Strings are immutable, so
/// each `+=` allocates a new string and copies the accumulated text — O(n^2) over
/// the loop. `StringBuilder` accumulates in place. The compound-assignment target's
/// resolved type (string) is what separates this from numeric `+=`.
/// </summary>
internal sealed class StringConcatInLoop : ISemanticRule
{
    public string RuleKey => "performance/deterministic/string-concat-in-loop";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var assign in tree.GetRoot().DescendantNodes().OfType<AssignmentExpressionSyntax>())
        {
            if (!assign.IsKind(SyntaxKind.AddAssignmentExpression)) continue;
            if (model.GetTypeInfo(assign.Left).Type?.SpecialType != SpecialType.System_String) continue;
            if (!IsInLoop(assign)) continue;

            var pos = assign.GetLocation().GetLineSpan().StartLinePosition;
            yield return new Violation(
                RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                "String += inside a loop reallocates and copies the whole string each iteration (O(n^2)) — accumulate with StringBuilder.");
        }
    }

    private static bool IsInLoop(SyntaxNode node)
    {
        for (var n = node.Parent; n is not null; n = n.Parent)
        {
            switch (n)
            {
                case ForStatementSyntax:
                case ForEachStatementSyntax:
                case WhileStatementSyntax:
                case DoStatementSyntax:
                    return true;
                // Stop climbing at a method/lambda boundary — a loop further out does
                // not enclose this assignment.
                case MethodDeclarationSyntax:
                case LocalFunctionStatementSyntax:
                case AnonymousFunctionExpressionSyntax:
                case AccessorDeclarationSyntax:
                case ConstructorDeclarationSyntax:
                    return false;
            }
        }
        return false;
    }
}
