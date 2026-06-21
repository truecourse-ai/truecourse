using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// A Span&lt;T&gt; / ReadOnlySpan&lt;T&gt; compared to `null` (via the implicit
/// conversion from null to an empty span) or to `default`. Both sides become
/// Span&lt;T&gt;.Empty, so the comparison tests emptiness, not what the author
/// likely meant. Needs the operand's resolved type to be a span. CA2265.
/// </summary>
internal sealed class SpanComparedToNull : ISemanticRule
{
    public string RuleKey => "bugs/deterministic/span-compared-to-null";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var bin in tree.GetRoot().DescendantNodes().OfType<BinaryExpressionSyntax>())
        {
            if (!bin.IsKind(SyntaxKind.EqualsExpression) && !bin.IsKind(SyntaxKind.NotEqualsExpression))
                continue;

            var (spanSide, litSide) = ClassifySides(bin);
            if (spanSide is null || litSide is null) continue;

            var spanType = model.GetTypeInfo(spanSide).Type;
            if (!IsSpan(spanType)) continue;

            var pos = bin.GetLocation().GetLineSpan().StartLinePosition;
            yield return new Violation(
                RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                "A Span<T> is compared to null/default — both convert to Span<T>.Empty, so this tests emptiness, not identity. Use IsEmpty.");
        }
    }

    private static (ExpressionSyntax? span, ExpressionSyntax? lit) ClassifySides(BinaryExpressionSyntax bin)
    {
        if (IsNullOrDefault(bin.Right)) return (bin.Left, bin.Right);
        if (IsNullOrDefault(bin.Left)) return (bin.Right, bin.Left);
        return (null, null);
    }

    private static bool IsNullOrDefault(ExpressionSyntax e)
    {
        while (e is ParenthesizedExpressionSyntax p) e = p.Expression;
        return e.IsKind(SyntaxKind.NullLiteralExpression) ||
               e.IsKind(SyntaxKind.DefaultLiteralExpression) ||
               e is DefaultExpressionSyntax;
    }

    private static bool IsSpan(ITypeSymbol? type) =>
        type is INamedTypeSymbol
        {
            Name: "Span" or "ReadOnlySpan",
            ContainingNamespace: { Name: "System", ContainingNamespace.IsGlobalNamespace: true },
        };
}
