using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// Bitwise OR / AND / XOR applied to operands of an enum type that is NOT marked
/// [Flags]. Combining or masking the members of a plain enum yields a value with
/// no declared member — a logic error or a missing attribute. Needs the resolved
/// operand type plus its attributes. S3265 / RCS1130.
/// </summary>
internal sealed class BitwiseOnNonFlagsEnum : ISemanticRule
{
    public string RuleKey => "bugs/deterministic/bitwise-on-non-flags-enum";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var bin in tree.GetRoot().DescendantNodes().OfType<BinaryExpressionSyntax>())
        {
            if (!bin.IsKind(SyntaxKind.BitwiseOrExpression) &&
                !bin.IsKind(SyntaxKind.BitwiseAndExpression) &&
                !bin.IsKind(SyntaxKind.ExclusiveOrExpression))
                continue;

            // Both operands must be the same enum for this to be an enum combine/mask.
            var left = model.GetTypeInfo(bin.Left).Type;
            var right = model.GetTypeInfo(bin.Right).Type;
            if (left is not INamedTypeSymbol { TypeKind: TypeKind.Enum } enumType) continue;
            if (!SymbolEqualityComparer.Default.Equals(left, right)) continue;

            if (HasFlagsAttribute(enumType)) continue;

            var pos = bin.GetLocation().GetLineSpan().StartLinePosition;
            yield return new Violation(
                RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                $"Bitwise '{bin.OperatorToken.Text}' on enum '{enumType.Name}', which is not marked [Flags] — the combined value has no defined member. Add [Flags] or fix the logic.");
        }
    }

    private static bool HasFlagsAttribute(INamedTypeSymbol type) =>
        type.GetAttributes().Any(a => a.AttributeClass is
        {
            Name: "FlagsAttribute",
            ContainingNamespace: { Name: "System", ContainingNamespace.IsGlobalNamespace: true },
        });
}
