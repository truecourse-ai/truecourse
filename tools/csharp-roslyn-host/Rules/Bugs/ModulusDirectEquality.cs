using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// `x % n == k` (or `!=`) where the operand is a signed integer and the right side is a
/// non-zero constant, e.g. `x % 2 == 1` to test oddness. For negative x the C# `%`
/// result is negative, so the equality never holds and negative odd values slip
/// through — a sign-handling bug. We require: signed integer modulus, compared against
/// a non-zero integer constant with `==`/`!=`. Comparing against 0 is safe. Needs the
/// operand type to confirm it is signed. S2197.
/// </summary>
internal sealed class ModulusDirectEquality : ISemanticRule
{
    public string RuleKey => "bugs/deterministic/modulus-direct-equality";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var cmp in tree.GetRoot().DescendantNodes().OfType<BinaryExpressionSyntax>())
        {
            if (!cmp.IsKind(SyntaxKind.EqualsExpression) && !cmp.IsKind(SyntaxKind.NotEqualsExpression))
                continue;

            // One side a `% ` expression, the other a constant != 0.
            var (modExpr, constExpr) =
                cmp.Left is BinaryExpressionSyntax lb && lb.IsKind(SyntaxKind.ModuloExpression)
                    ? (lb, cmp.Right)
                : cmp.Right is BinaryExpressionSyntax rb && rb.IsKind(SyntaxKind.ModuloExpression)
                    ? (rb, cmp.Left)
                    : (null, null);
            if (modExpr is null || constExpr is null) continue;

            // The compared-against value must be a non-zero compile-time constant.
            var cv = model.GetConstantValue(constExpr);
            if (!cv.HasValue || cv.Value is null) continue;
            if (!IsNonZeroInteger(cv.Value)) continue;

            // The dividend must be a SIGNED integer type (negative inputs are the hazard).
            var dividendType = model.GetTypeInfo(modExpr.Left).Type;
            if (!IsSignedInteger(dividendType)) continue;

            var pos = cmp.GetLocation().GetLineSpan().StartLinePosition;
            yield return new Violation(
                RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                "Equality on a signed modulus result is wrong for negative inputs — '%' yields a negative remainder, so the comparison never holds. Compare with 0 or guard the sign.");
        }
    }

    private static bool IsNonZeroInteger(object v) => v switch
    {
        sbyte x => x != 0,
        byte x => x != 0,
        short x => x != 0,
        ushort x => x != 0,
        int x => x != 0,
        uint x => x != 0,
        long x => x != 0,
        ulong x => x != 0,
        _ => false,
    };

    private static bool IsSignedInteger(ITypeSymbol? t) => t?.SpecialType is
        SpecialType.System_SByte or SpecialType.System_Int16 or
        SpecialType.System_Int32 or SpecialType.System_Int64;
}
