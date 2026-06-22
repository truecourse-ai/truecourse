using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// Subtraction (`-` or `-=`) applied to delegate operands. Multicast delegate removal
/// matches the invocation list by sequence from the end, so subtracting a composite
/// delegate rarely removes what the author expects, and `-=` on event-like fields can
/// silently no-op. Needs the operand type to confirm it is a delegate.
/// </summary>
internal sealed class DelegateSubtraction : ISemanticRule
{
    public string RuleKey => "bugs/deterministic/delegate-subtraction";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        var root = tree.GetRoot();

        foreach (var bin in root.DescendantNodes().OfType<BinaryExpressionSyntax>())
        {
            if (!bin.IsKind(SyntaxKind.SubtractExpression)) continue;
            if (!IsDelegate(model.GetTypeInfo(bin.Left).Type)) continue;

            var pos = bin.OperatorToken.GetLocation().GetLineSpan().StartLinePosition;
            yield return new Violation(
                RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                "Delegate subtraction has surprising multicast removal semantics and rarely removes the intended invocation. Avoid combining delegates with '-'.");
        }

        foreach (var assign in root.DescendantNodes().OfType<AssignmentExpressionSyntax>())
        {
            if (!assign.IsKind(SyntaxKind.SubtractAssignmentExpression)) continue;
            // `-=` on an event is the normal unsubscribe path — exclude events.
            if (model.GetSymbolInfo(assign.Left).Symbol is IEventSymbol) continue;
            if (!IsDelegate(model.GetTypeInfo(assign.Left).Type)) continue;

            var pos = assign.OperatorToken.GetLocation().GetLineSpan().StartLinePosition;
            yield return new Violation(
                RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                "Delegate subtraction ('-=' on a delegate field) has surprising multicast removal semantics. Prefer an event with add/remove, or rebuild the invocation list explicitly.");
        }
    }

    private static bool IsDelegate(ITypeSymbol? t) => t is { TypeKind: TypeKind.Delegate };
}
