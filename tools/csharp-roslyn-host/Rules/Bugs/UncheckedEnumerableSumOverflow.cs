using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TrueCourse.RoslynHost;

/// <summary>
/// Enumerable.Sum over an integral sequence is called inside an `unchecked` context. Sum
/// itself does overflow-checked addition by design; wrapping it in `unchecked` (or compiling
/// with overflow checks off and an explicit `unchecked` block) silently disables that, so an
/// overflow wraps to a wrong total instead of throwing. We confirm the invocation binds to
/// System.Linq.Enumerable.Sum and sits in an unchecked expression/statement. S2291.
/// </summary>
internal sealed class UncheckedEnumerableSumOverflow : ISemanticRule
{
    public string RuleKey => "bugs/deterministic/unchecked-enumerable-sum-overflow";

    public IEnumerable<Violation> Analyze(SemanticModel model, SyntaxTree tree)
    {
        foreach (var inv in tree.GetRoot().DescendantNodes().OfType<InvocationExpressionSyntax>())
        {
            if (model.GetSymbolInfo(inv).Symbol is not IMethodSymbol m) continue;
            if (m.Name != "Sum") continue;
            if (m.ContainingType is not { Name: "Enumerable", ContainingNamespace.Name: "Linq" }) continue;

            // Sum over floating-point can't overflow-throw; only the integral overloads do.
            var ret = m.ReturnType.SpecialType;
            if (ret is not (SpecialType.System_Int32 or SpecialType.System_Int64 or
                            SpecialType.System_UInt32 or SpecialType.System_UInt64) &&
                !(m.ReturnType is INamedTypeSymbol { OriginalDefinition.SpecialType: SpecialType.System_Nullable_T } n &&
                  n.TypeArguments[0].SpecialType is SpecialType.System_Int32 or SpecialType.System_Int64 or
                      SpecialType.System_UInt32 or SpecialType.System_UInt64))
                continue;

            if (!InUncheckedContext(inv)) continue;

            var pos = inv.GetLocation().GetLineSpan().StartLinePosition;
            yield return new Violation(
                RuleKey, tree.FilePath, pos.Line + 1, pos.Character + 1,
                "Enumerable.Sum is inside an 'unchecked' context, which disables its overflow check — an overflow silently wraps instead of throwing.");
        }
    }

    private static bool InUncheckedContext(SyntaxNode node)
    {
        for (var n = node.Parent; n is not null; n = n.Parent)
        {
            switch (n)
            {
                case CheckedExpressionSyntax ce:
                    return ce.Keyword.IsKind(Microsoft.CodeAnalysis.CSharp.SyntaxKind.UncheckedKeyword);
                case CheckedStatementSyntax cs:
                    return cs.Keyword.IsKind(Microsoft.CodeAnalysis.CSharp.SyntaxKind.UncheckedKeyword);
            }
        }
        return false;
    }
}
